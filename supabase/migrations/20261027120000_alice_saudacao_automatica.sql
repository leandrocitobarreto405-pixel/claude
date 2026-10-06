-- Alice: a saudação (e a mensagem de ausência) automática do WhatsApp Business do celular não é
-- atendente humano assumindo a conversa.
--
-- Com a coexistência, o que sai do app do celular chega pelo Chatwoot como eco: sem remetente
-- (sender nulo) e content_attributes.external_echo = true. O eco não diz se foi digitado ou
-- automático, então vale a regra:
--   (a) eco que chega até 10 s da primeira mensagem do cliente numa conversa nova (sem nada
--       enviado antes), ou
--   (b) eco com o mesmo texto de uma mensagem que já se comportou como (a) nesta empresa
--       (saudação/ausência já vista),
-- não tira a Alice. Mensagem escrita pelo Chatwoot (remetente atendente) continua tirando sempre.

CREATE OR REPLACE FUNCTION private.ia_mensagem_automatica(_msg public.whatsapp_messages)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  payload jsonb;
  primeira timestamptz;
BEGIN
  IF _msg.direction IS DISTINCT FROM 'Enviada' OR _msg.privada
     OR coalesce(btrim(_msg.text_content), '') = ''
     OR coalesce(_msg.raw_event_reference, '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN false;
  END IF;
  SELECT e.payload INTO payload FROM public.integracao_eventos e
   WHERE e.id = _msg.raw_event_reference::uuid;
  -- Só o eco do app do celular (sem remetente e com external_echo).
  IF payload IS NULL
     OR coalesce(jsonb_typeof(payload->'sender'), 'null') <> 'null'
     OR coalesce(payload->'content_attributes'->>'external_echo', '') <> 'true' THEN
    RETURN false;
  END IF;

  -- (a) Conversa nova: até 10 s (antes ou depois) da primeira mensagem do cliente.
  SELECT min(r.message_timestamp) INTO primeira FROM public.whatsapp_messages r
   WHERE r.conversa_id = _msg.conversa_id AND r.direction = 'Recebida';
  IF primeira IS NOT NULL
     AND abs(extract(epoch FROM _msg.message_timestamp - primeira)) <= 10
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_messages o
        WHERE o.conversa_id = _msg.conversa_id AND o.id <> _msg.id
          AND o.direction = 'Enviada' AND NOT o.privada
          AND o.message_timestamp < primeira - interval '10 seconds') THEN
    RETURN true;
  END IF;

  -- (b) Mesmo texto de uma saudação/ausência já vista nesta empresa.
  RETURN EXISTS (
    SELECT 1 FROM public.whatsapp_messages o
     WHERE o.empresa_id = _msg.empresa_id AND o.id <> _msg.id
       AND o.direction = 'Enviada' AND NOT o.privada
       AND o.text_content = _msg.text_content
       AND o.message_timestamp > _msg.message_timestamp - interval '180 days'
       AND abs(extract(epoch FROM o.message_timestamp - (
             SELECT min(r.message_timestamp) FROM public.whatsapp_messages r
              WHERE r.conversa_id = o.conversa_id AND r.direction = 'Recebida'))) <= 10);
END $$;
REVOKE ALL ON FUNCTION private.ia_mensagem_automatica(public.whatsapp_messages) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.ia_agendar_por_mensagem()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
       AND private.ia_cliente_antigo(NEW.whatsapp_contact_id)
       AND NOT private.mkt_resposta_de_campanha(NEW.empresa_id, NEW.whatsapp_contact_id) THEN
      PERFORM private.ia_tirar_alice(NEW, 'cliente antigo: fica com a equipe',
        '🤖 Cliente antigo (já tem cadastro ou serviço feito): a Alice não respondeu e deixou a conversa com a equipe. Se quiser que ela atenda, mande a nota #alice.');
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
    -- Atendente humano escreveu (no Chatwoot ou no WhatsApp do celular): a Alice sai da conversa.
    PERFORM private.ia_tirar_alice(NEW, 'atendente humano assumiu', NULL);
  END IF;
  RETURN NEW;
END $$;
