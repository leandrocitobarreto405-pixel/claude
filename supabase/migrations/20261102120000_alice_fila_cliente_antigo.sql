-- Alice: uma execução por conversa, cliente antigo = serviço realizado, um follow-up por conversa.
-- Nada existente é apagado: a função antiga ia_cliente_antigo(uuid) continua existindo.

-- 1. Reserva: não começa uma tarefa da Alice (responder, follow-up, mensagens programadas) se
--    outra da mesma conversa está em andamento há menos de 10 minutos. A tarefa continua
--    pendente, adiada alguns segundos e marcada para voltar à fila (o servidor reenfileira).
--    Assim duas respostas nunca rodam ao mesmo tempo na mesma conversa.
CREATE OR REPLACE FUNCTION public.ia_reservar_tarefa(_tarefa_id uuid)
RETURNS public.ia_tarefas LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  t public.ia_tarefas;
BEGIN
  SELECT * INTO t FROM public.ia_tarefas
   WHERE id = _tarefa_id AND situacao = 'pendente' AND executar_apos <= now() + interval '1 second'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF t.tipo IN ('responder', 'followup', 'enviar_mensagens') THEN
    -- Trava por conversa: duas reservas simultâneas da mesma conversa esperam uma pela outra.
    PERFORM pg_advisory_xact_lock(hashtextextended('ia_conversa:' || t.conversa_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM public.ia_tarefas o
       WHERE o.conversa_id = t.conversa_id AND o.id <> t.id
         AND o.tipo IN ('responder', 'followup', 'enviar_mensagens')
         AND o.situacao = 'processando' AND o.iniciada_em > now() - interval '10 minutes'
    ) THEN
      UPDATE public.ia_tarefas
         SET executar_apos = greatest(executar_apos, now() + interval '8 seconds'), enfileirada = false
       WHERE id = t.id;
      RETURN NULL;
    END IF;
  END IF;
  UPDATE public.ia_tarefas
     SET situacao = 'processando', iniciada_em = now(), tentativas = tentativas + 1
   WHERE id = t.id
  RETURNING * INTO t;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.ia_reservar_tarefa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_reservar_tarefa(uuid) TO service_role;

-- 2. Cliente antigo = já teve SERVIÇO REALIZADO antes de _desde: atendimento concluído numa OS
--    dele, lead com serviço realizado ou comprador na base de marketing (inclui a importação de
--    clientes atendidos antes do sistema). Cadastro, orçamento ou OS ainda não realizada não
--    contam (a OS que a Alice marcou na conversa só conta depois de realizada).
CREATE OR REPLACE FUNCTION private.ia_cliente_antigo(_contato uuid, _desde timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ct AS (
    SELECT id, empresa_id, normalized_phone, current_customer_id
      FROM public.whatsapp_contacts WHERE id = _contato
  ), leads AS (
    SELECT l.id, l.customer_id, l.linked_work_order_id, l.realizado_em
      FROM public.crm_leads l, ct
     WHERE l.whatsapp_contact_id = ct.id AND l.empresa_id = ct.empresa_id
  ), clientes AS (
    SELECT current_customer_id AS id FROM ct WHERE current_customer_id IS NOT NULL
    UNION SELECT customer_id FROM leads WHERE customer_id IS NOT NULL
  )
  SELECT EXISTS (SELECT 1 FROM leads WHERE realizado_em <= _desde)
    OR EXISTS (
      SELECT 1
        FROM public.visits v JOIN public.work_orders w ON w.id = v.work_order_id, ct
       WHERE w.empresa_id = ct.empresa_id AND w.deleted_at IS NULL AND v.status = 'Concluído'
         AND coalesce((v.completion_date + coalesce(v.completion_time, time '12:00'))
                        AT TIME ZONE 'America/Sao_Paulo', v.updated_at) <= _desde
         AND (w.customer_id IN (SELECT id FROM clientes)
              OR w.id IN (SELECT linked_work_order_id FROM leads WHERE linked_work_order_id IS NOT NULL)))
    OR EXISTS (
      SELECT 1 FROM public.mkt_contatos m, ct
       WHERE m.empresa_id = ct.empresa_id AND m.tipo = 'comprador'
         AND private.telefone_chave(m.normalized_phone) = private.telefone_chave(ct.normalized_phone)
         AND (m.ultimo_servico_em IS NULL OR m.ultimo_servico_em <= _desde));
$$;
REVOKE ALL ON FUNCTION private.ia_cliente_antigo(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- 3. Gatilho das mensagens: igual ao anterior, só troca a regra do cliente antigo (e a nota).
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
    -- Atendente humano escreveu (no Chatwoot ou no WhatsApp do celular): a Alice sai da conversa.
    PERFORM private.ia_tirar_alice(NEW, 'atendente humano assumiu', NULL);
  END IF;
  RETURN NEW;
END $$;

-- 4. Um follow-up pendente por conversa (da equipe ou da Alice). Os follow-ups criados pela
--    Alice passam a guardar a conversa; ao entrar um novo, os pendentes anteriores da mesma
--    conversa são cancelados (e a tarefa da Alice ligada a eles também). Os follow-ups antigos,
--    sem conversa, criados pela Alice para o mesmo lead (nota começando com 🤖) também.
--    Follow-ups criados à mão no CRM (sem conversa) não são tocados.
ALTER TABLE public.crm_followups
  ADD COLUMN IF NOT EXISTS conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_crm_followups_conversa_pendente
  ON public.crm_followups (conversa_id) WHERE status = 'Pendente';

CREATE OR REPLACE FUNCTION private.crm_followup_unico_por_conversa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION private.crm_followup_unico_por_conversa() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_followup_unico_por_conversa') THEN
    CREATE TRIGGER trg_crm_followup_unico_por_conversa AFTER INSERT ON public.crm_followups
      FOR EACH ROW EXECUTE FUNCTION private.crm_followup_unico_por_conversa();
  END IF;
END $$;
