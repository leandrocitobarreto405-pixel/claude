-- Follow-up 3 e 4 da trilha A com a equipe (05/11): a tarefa da atendente faz parte da sequência.
-- 1) "Um follow-up por conversa" não cancela a tarefa do toque da equipe (A3/A4, canal equipe)
--    quando o toque seguinte da Alice é agendado.
-- 2) A mensagem que a atendente manda pela tarefa (enquanto ela está aberta, ou até 2 h depois de
--    marcada como feita) não tira a Alice da conversa nem cancela o próximo toque.
-- Nada é apagado; só as duas funções mudam.

CREATE OR REPLACE FUNCTION private.crm_followup_unico_por_conversa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  tarefas uuid[];
BEGIN
  IF NEW.conversa_id IS NULL OR NEW.status IS DISTINCT FROM 'Pendente' THEN
    RETURN NEW;
  END IF;
  WITH f AS (
    UPDATE public.crm_followups
       SET status = 'Cancelada', completed_at = now(), result = 'substituído por um novo follow-up'
     WHERE id <> NEW.id AND status = 'Pendente' AND empresa_id = NEW.empresa_id
       AND (conversa_id = NEW.conversa_id
            OR (conversa_id IS NULL AND crm_lead_id = NEW.crm_lead_id AND notes LIKE '🤖%'))
       -- Tarefa do toque da equipe (trilha A 3 e 4): segue aberta até a atendente fazer.
       AND NOT (coalesce(canal, '') = 'equipe' AND coalesce(etapa, '') IN ('A3', 'A4'))
    RETURNING ia_tarefa_id
  )
  SELECT array_agg(ia_tarefa_id) FILTER (WHERE ia_tarefa_id IS NOT NULL) INTO tarefas FROM f;
  IF tarefas IS NOT NULL THEN
    UPDATE public.ia_tarefas
       SET situacao = 'ignorada', motivo = 'substituído por um novo follow-up', concluida_em = now()
     WHERE id = ANY (tarefas) AND tipo = 'followup' AND situacao = 'pendente'
       AND id IS DISTINCT FROM NEW.ia_tarefa_id;
  END IF;
  UPDATE public.crm_leads l
     SET next_follow_up_at = (SELECT min(scheduled_at) FROM public.crm_followups
                               WHERE crm_lead_id = l.id AND status = 'Pendente')
   WHERE l.id = NEW.crm_lead_id;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private.ia_agendar_por_mensagem()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.ia_configuracoes;
  conversa public.conversas;
  comando text;
BEGIN
  IF NEW.conversa_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Comando da equipe (nota privada ou mensagem): vale mesmo com a Alice desligada na empresa,
  -- para a equipe ter a confirmação e o #desligar ficar gravado no cliente.
  IF NEW.direction = 'Enviada' AND NEW.remetente_tipo = 'user' THEN
    comando := private.ia_comando_da_equipe(NEW.text_content);
    IF comando IS NOT NULL THEN
      PERFORM private.ia_executar_comando(NEW, comando);
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.privada THEN
    RETURN NEW;
  END IF;
  -- Cliente respondeu: o follow-up agendado perde o sentido (a resposta nova cuida da conversa).
  IF NEW.direction = 'Recebida' THEN
    PERFORM private.ia_cancelar_followups(NEW.conversa_id, 'cliente respondeu');
  END IF;

  SELECT * INTO cfg FROM public.ia_configuracoes WHERE empresa_id = NEW.empresa_id AND ativo;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_contacts WHERE id = NEW.whatsapp_contact_id AND ia_desligada) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO conversa FROM public.conversas WHERE id = NEW.conversa_id;
  IF conversa.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.direction = 'Recebida' THEN
    IF cfg.clientes_antigos_com_equipe AND conversa.devolvida_para_alice_em IS NULL
       AND private.ia_cliente_antigo(NEW.whatsapp_contact_id, coalesce(NEW.message_timestamp, now()))
       AND NOT private.mkt_resposta_de_campanha(NEW.empresa_id, NEW.whatsapp_contact_id) THEN
      PERFORM private.ia_tirar_alice(NEW, 'cliente antigo: fica com a equipe',
        '🤖 Cliente antigo (já teve serviço realizado): a Alice não respondeu e deixou a conversa com a equipe. Se quiser que ela atenda, mande a nota #alice.');
      RETURN NEW;
    END IF;
    INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo, executar_apos)
    VALUES (NEW.empresa_id, NEW.conversa_id, 'responder', now() + make_interval(secs => cfg.espera_segundos))
    ON CONFLICT (conversa_id, tipo) WHERE situacao = 'pendente'
    DO UPDATE SET executar_apos = EXCLUDED.executar_apos, enfileirada = false;
  ELSIF NEW.direction = 'Enviada' AND NEW.remetente_tipo = 'user' THEN
    -- Saudação/ausência automática do WhatsApp Business do celular: não é ninguém assumindo.
    IF private.ia_mensagem_automatica(NEW) THEN
      RETURN NEW;
    END IF;
    -- Mensagem da tarefa do toque da equipe (trilha A 3 e 4, 05/11): faz parte da sequência; a
    -- Alice não sai e o próximo toque continua agendado.
    IF EXISTS (
      SELECT 1 FROM public.crm_followups f
       WHERE f.conversa_id = NEW.conversa_id AND f.canal = 'equipe' AND f.etapa IN ('A3', 'A4')
         AND f.status <> 'Cancelada'
         AND f.scheduled_at - interval '30 minutes' <= coalesce(NEW.message_timestamp, now())
         AND (f.completed_at IS NULL
              OR f.completed_at + interval '2 hours' >= coalesce(NEW.message_timestamp, now()))
    ) THEN
      RETURN NEW;
    END IF;
    -- Atendente humano escreveu (no Chatwoot ou no WhatsApp do celular): a Alice sai da conversa.
    PERFORM private.ia_tirar_alice(NEW, 'atendente humano assumiu', NULL);
  END IF;
  RETURN NEW;
END $function$;
