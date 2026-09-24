ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by uuid,
  ADD COLUMN IF NOT EXISTS reopen_reason text;

ALTER TABLE public.daily_routes
  ADD COLUMN IF NOT EXISTS last_auto_sync_at timestamptz;

CREATE TABLE IF NOT EXISTS public.payment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_payment_channel text,
  previous_payment_type text,
  previous_installments integer,
  previous_gross_amount numeric,
  previous_applied_rate numeric,
  previous_payment_fee_amount numeric,
  previous_net_amount numeric,
  previous_payment_date date,
  previous_payment_status text,
  new_payment_channel text,
  new_payment_type text,
  new_installments integer,
  new_gross_amount numeric,
  new_applied_rate numeric,
  new_payment_fee_amount numeric,
  new_net_amount numeric,
  new_payment_date date,
  new_payment_status text,
  reason text,
  notes text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.payment_history TO authenticated;
GRANT ALL ON public.payment_history TO service_role;
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_history_select_staff" ON public.payment_history;
CREATE POLICY "payment_history_select_staff" ON public.payment_history
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "payment_history_insert_staff" ON public.payment_history;
CREATE POLICY "payment_history_insert_staff" ON public.payment_history
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_payment_history_payment ON public.payment_history(payment_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  reference_date date,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'Em execução',
  technicians_processed integer NOT NULL DEFAULT 0,
  routes_created integer NOT NULL DEFAULT 0,
  routes_updated integer NOT NULL DEFAULT 0,
  routes_skipped integer NOT NULL DEFAULT 0,
  expenses_created integer NOT NULL DEFAULT 0,
  expenses_updated integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.job_runs TO authenticated;
GRANT ALL ON public.job_runs TO service_role;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_runs_select_staff" ON public.job_runs;
CREATE POLICY "job_runs_select_staff" ON public.job_runs
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_job_runs_name_date ON public.job_runs(job_name, reference_date DESC);

INSERT INTO public.config_options (kind, name, active, display_order)
SELECT v.name, v.label, true, v.ord
FROM (VALUES
  ('payment_reopen_reason', 'Forma de pagamento incorreta', 1),
  ('payment_reopen_reason', 'Número de parcelas incorreto', 2),
  ('payment_reopen_reason', 'Valor informado incorretamente', 3),
  ('payment_reopen_reason', 'Pagamento ainda não confirmado', 4),
  ('payment_reopen_reason', 'Estorno', 5),
  ('payment_reopen_reason', 'Outro', 6)
) AS v(name, label, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.config_options c WHERE c.kind = v.name AND c.name = v.label
);