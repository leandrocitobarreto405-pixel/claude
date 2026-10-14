-- Retornos (crm_followups) da equipe: fecham sozinhos e, vencidos há mais de 3 dias, expiram.
--
-- 1. Mensagem digitada por uma pessoa da equipe na conversa do lead fecha os retornos pendentes
--    da equipe daquele lead ("Concluída / Equipe respondeu na conversa"). Como cada mensagem
--    chega em whatsapp_messages (tudo vem do webhook do Chatwoot, origem 'chatwoot'):
--      · pessoa da equipe no Chatwoot ..... direction 'Enviada', remetente_tipo 'user', privada false  → CONTA
--      · nota privada da equipe ........... remetente_tipo 'user', privada true ..................... → não conta
--      · Alice (texto, áudio, nota) ....... remetente_tipo 'agent_bot' ............................. → não conta
--      · campanhas de marketing, confirmação de véspera, pós-venda, tc_lead_site e qualquer envio
--        automático do app: saem pelo token do robô (alice_bot_token) → remetente_tipo 'agent_bot'  → não conta
--      · cliente .......................... direction 'Recebida', remetente_tipo 'contact' ........... → não conta
--    Os da Alice já são cancelados quando alguém da equipe assume (ia_cancelar_followups).
-- 2. Lead que ganha OS ou é encerrado fecha os retornos pendentes (equipe: "Concluída"; Alice:
--    cancelada junto com a tarefa dela, como já acontece hoje).
-- 3. crm_expirar_retornos(): retorno da equipe vencido há mais de 3 dias vira "Vencida" e some da
--    lista (a varredura chama de 5 em 5 min). Os da Alice não são tocados.
-- Os gatilhos são à prova de falha: qualquer erro dentro deles é capturado, gravado em
-- gatilho_erros e NUNCA impede a gravação da mensagem ou do lead. Em todos os casos o
-- next_follow_up_at do lead é recalculado, como já fazem as funções atuais.

-- ---------------------------------------------------------------- erros dos gatilhos
CREATE TABLE IF NOT EXISTS public.gatilho_erros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  gatilho text NOT NULL,
  erro text NOT NULL,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gatilho_erros_empresa ON public.gatilho_erros (empresa_id, created_at DESC);
ALTER TABLE public.gatilho_erros ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gatilho_erros TO authenticated;
GRANT ALL ON public.gatilho_erros TO service_role;
DROP POLICY IF EXISTS gatilho_erros_admin ON public.gatilho_erros;
CREATE POLICY gatilho_erros_admin ON public.gatilho_erros FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.meu_papel()) = 'admin'::public.papel_empresa);

-- Índice leve para achar os retornos pendentes de um lead.
CREATE INDEX IF NOT EXISTS crm_followups_lead_pendente_idx
  ON public.crm_followups (crm_lead_id) WHERE status = 'Pendente';

-- ---------------------------------------------------------------- fechar retornos de um lead
-- _quem: 'equipe' (só os da equipe) ou 'todos' (equipe conclui; Alice cancela com a tarefa).
CREATE OR REPLACE FUNCTION private.crm_fechar_retornos(_lead uuid, _motivo text, _quem text DEFAULT 'equipe')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n int := 0;
  conv uuid;
BEGIN
  -- Só para o teste de banco provar que a falha não trava a mensagem.
  IF current_setting('nexa.teste_falha_retornos', true) = '1' THEN
    RAISE EXCEPTION 'falha simulada no fechamento de retornos';
  END IF;

  UPDATE public.crm_followups
     SET status = 'Concluída', completed_at = now(), result = _motivo
   WHERE crm_lead_id = _lead AND status = 'Pendente' AND responsavel = 'equipe';
  GET DIAGNOSTICS n = ROW_COUNT;

  IF _quem = 'todos' THEN
    FOR conv IN
      SELECT DISTINCT conversa_id FROM public.crm_followups
       WHERE crm_lead_id = _lead AND status = 'Pendente' AND responsavel = 'alice' AND conversa_id IS NOT NULL
    LOOP
      PERFORM private.ia_cancelar_followups(conv, _motivo);
    END LOOP;
    -- Da Alice sem conversa (antigos): cancela direto.
    UPDATE public.crm_followups
       SET status = 'Cancelada', completed_at = now(), result = _motivo
     WHERE crm_lead_id = _lead AND status = 'Pendente' AND responsavel = 'alice';
  END IF;

  UPDATE public.crm_leads l
     SET next_follow_up_at = (SELECT min(scheduled_at) FROM public.crm_followups
                               WHERE crm_lead_id = l.id AND status = 'Pendente')
   WHERE l.id = _lead;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.crm_fechar_retornos(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- gatilho: mensagem da equipe
CREATE OR REPLACE FUNCTION private.crm_retornos_por_mensagem()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM private.crm_fechar_retornos(NEW.crm_lead_id, 'Equipe respondeu na conversa', 'equipe');
  EXCEPTION WHEN OTHERS THEN
    -- Nunca impede a gravação da mensagem: registra e segue.
    BEGIN
      INSERT INTO public.gatilho_erros (empresa_id, gatilho, erro, detalhe)
      VALUES (NEW.empresa_id, 'crm_retornos_por_mensagem', SQLERRM,
              jsonb_build_object('mensagem_id', NEW.id, 'crm_lead_id', NEW.crm_lead_id, 'sqlstate', SQLSTATE));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'crm_retornos_por_mensagem: % (e não deu para registrar: %)', SQLERRM, SQLERRM;
    END;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_crm_retornos_por_mensagem ON public.whatsapp_messages;
-- A condição no WHEN mantém o gatilho leve: a função só roda para mensagem de pessoa da equipe.
CREATE TRIGGER trg_crm_retornos_por_mensagem AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (NEW.direction = 'Enviada' AND NEW.remetente_tipo = 'user' AND NOT NEW.privada
        AND NEW.crm_lead_id IS NOT NULL)
  EXECUTE FUNCTION private.crm_retornos_por_mensagem();

-- ---------------------------------------------------------------- gatilho: lead virou OS / encerrado
CREATE OR REPLACE FUNCTION private.crm_retornos_por_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  motivo text;
BEGIN
  IF OLD.linked_work_order_id IS NULL AND NEW.linked_work_order_id IS NOT NULL THEN
    motivo := 'Lead virou OS';
  ELSIF OLD.is_open AND NOT NEW.is_open THEN
    motivo := 'Lead encerrado';
  ELSE
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM private.crm_fechar_retornos(NEW.id, motivo, 'todos');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.gatilho_erros (empresa_id, gatilho, erro, detalhe)
      VALUES (NEW.empresa_id, 'crm_retornos_por_lead', SQLERRM,
              jsonb_build_object('crm_lead_id', NEW.id, 'motivo', motivo, 'sqlstate', SQLSTATE));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'crm_retornos_por_lead: %', SQLERRM;
    END;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_crm_retornos_por_lead ON public.crm_leads;
CREATE TRIGGER trg_crm_retornos_por_lead AFTER UPDATE OF is_open, linked_work_order_id ON public.crm_leads
  FOR EACH ROW
  WHEN ((OLD.is_open AND NOT NEW.is_open)
        OR (OLD.linked_work_order_id IS NULL AND NEW.linked_work_order_id IS NOT NULL))
  EXECUTE FUNCTION private.crm_retornos_por_lead();

-- ---------------------------------------------------------------- expirar vencidos (> 3 dias)
CREATE OR REPLACE FUNCTION public.crm_expirar_retornos()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  leads uuid[];
  n int;
BEGIN
  WITH f AS (
    UPDATE public.crm_followups
       SET status = 'Vencida', completed_at = now(), result = 'Sem resposta há mais de 3 dias'
     WHERE status = 'Pendente' AND responsavel = 'equipe'
       AND scheduled_at < now() - interval '3 days'
    RETURNING crm_lead_id
  )
  SELECT count(*), array_agg(DISTINCT crm_lead_id) INTO n, leads FROM f;
  IF leads IS NOT NULL THEN
    UPDATE public.crm_leads l
       SET next_follow_up_at = (SELECT min(scheduled_at) FROM public.crm_followups
                                 WHERE crm_lead_id = l.id AND status = 'Pendente')
     WHERE l.id = ANY (leads);
  END IF;
  RETURN coalesce(n, 0);
END $$;
REVOKE ALL ON FUNCTION public.crm_expirar_retornos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_expirar_retornos() TO service_role;
