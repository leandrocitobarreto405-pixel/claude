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
