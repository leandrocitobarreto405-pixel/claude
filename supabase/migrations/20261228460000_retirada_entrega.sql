-- Retirada e entrega de tapete e persiana (05/11, plano aprovado pelo dono).
-- O atendimento de retirada guarda o tipo (persiana ou tapete) e a entrega prevista, calculada pelo
-- app em dias úteis (persiana 7, tapete 15) e editável na OS. A entrega não é um atendimento novo:
-- é o segundo bloco na agenda, tirado do mesmo atendimento (não conta como serviço a mais).
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS retirada text,
  ADD COLUMN IF NOT EXISTS entrega_prevista date,
  ADD COLUMN IF NOT EXISTS entrega_editada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entrega_feita_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visits_retirada_check') THEN
    ALTER TABLE public.visits
      ADD CONSTRAINT visits_retirada_check CHECK (retirada IS NULL OR retirada IN ('persiana', 'tapete'));
  END IF;
END $$;

-- Agenda da entrega: busca por empresa e dia.
CREATE INDEX IF NOT EXISTS idx_visits_entrega_prevista
  ON public.visits (empresa_id, entrega_prevista)
  WHERE entrega_prevista IS NOT NULL;

COMMENT ON COLUMN public.visits.retirada IS 'Atendimento de retirada (persiana ou tapete); null nos atendimentos comuns.';
COMMENT ON COLUMN public.visits.entrega_prevista IS 'Entrega prevista: dias úteis depois da retirada (persiana 7, tapete 15), editável na OS.';
COMMENT ON COLUMN public.visits.entrega_editada IS 'A data de entrega foi mudada à mão (não recalcula sozinha).';
COMMENT ON COLUMN public.visits.entrega_feita_em IS 'Quando a entrega foi feita (botão Entregue na agenda).';

-- Confirmação da retirada e da entrega na véspera (tarefa da equipe, etapas RT e EN): não
-- cancela os outros follow-ups da conversa e não é cancelada por eles.
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
  -- Confirmação da retirada/entrega na véspera (05/11): tarefa à parte, não substitui nada.
  IF coalesce(NEW.canal, '') = 'equipe' AND coalesce(NEW.etapa, '') IN ('RT', 'EN') THEN
    RETURN NEW;
  END IF;
  WITH f AS (
    UPDATE public.crm_followups
       SET status = 'Cancelada', completed_at = now(), result = 'substituído por um novo follow-up'
     WHERE id <> NEW.id AND status = 'Pendente' AND empresa_id = NEW.empresa_id
       AND (conversa_id = NEW.conversa_id
            OR (conversa_id IS NULL AND crm_lead_id = NEW.crm_lead_id AND notes LIKE '🤖%'))
       -- Tarefa do toque da equipe (trilha A 3 e 4) e confirmação da retirada/entrega: seguem
       -- abertas até a atendente fazer.
       AND NOT (coalesce(canal, '') = 'equipe' AND coalesce(etapa, '') IN ('A3', 'A4', 'RT', 'EN'))
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
