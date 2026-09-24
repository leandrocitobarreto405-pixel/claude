-- 1) expenses: novos campos
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS beneficiary text,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'Manual',
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS daily_route_id uuid REFERENCES public.daily_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_key text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

UPDATE public.expenses
  SET paid_amount = COALESCE(actual_amount, 0)
  WHERE status = 'Pago' AND paid_amount = 0;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_recurring_due_unique
  ON public.expenses (recurring_expense_id, due_date)
  WHERE recurring_expense_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_reference_key_unique
  ON public.expenses (reference_key)
  WHERE reference_key IS NOT NULL AND deleted_at IS NULL;

-- 2) daily_routes: situação e rastreio
ALTER TABLE public.daily_routes
  ADD COLUMN IF NOT EXISTS route_status text NOT NULL DEFAULT 'Calculada',
  ADD COLUMN IF NOT EXISTS calculation_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS base_address text,
  ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS needs_recalculation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS financial_difference boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_amount_snapshot numeric,
  ADD COLUMN IF NOT EXISTS error_message text;

-- 3) rateio do custo da rota
CREATE TABLE IF NOT EXISTS public.route_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.daily_routes(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  service_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  allocated_kilometers numeric NOT NULL DEFAULT 0,
  allocated_cost numeric NOT NULL DEFAULT 0,
  allocation_method text NOT NULL DEFAULT 'divisao_igual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_cost_allocations TO authenticated;
GRANT ALL ON public.route_cost_allocations TO service_role;
ALTER TABLE public.route_cost_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rca_select" ON public.route_cost_allocations FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "rca_insert" ON public.route_cost_allocations FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "rca_update" ON public.route_cost_allocations FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "rca_delete" ON public.route_cost_allocations FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));
CREATE TRIGGER trg_rca_upd BEFORE UPDATE ON public.route_cost_allocations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE UNIQUE INDEX IF NOT EXISTS rca_route_service_unique ON public.route_cost_allocations (route_id, service_id);

-- 4) histórico de status da despesa
CREATE TABLE IF NOT EXISTS public.expense_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL,
  previous_paid_amount numeric,
  new_paid_amount numeric,
  previous_payment_date date,
  new_payment_date date,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  notes text
);
GRANT SELECT, INSERT ON public.expense_status_history TO authenticated;
GRANT ALL ON public.expense_status_history TO service_role;
ALTER TABLE public.expense_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "esh_select" ON public.expense_status_history FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "esh_insert" ON public.expense_status_history FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX IF NOT EXISTS esh_expense_idx ON public.expense_status_history (expense_id, changed_at DESC);

-- 5) modelos recorrentes
ALTER TABLE public.recurring_expenses
  ADD COLUMN IF NOT EXISTS beneficiary text,
  ADD COLUMN IF NOT EXISTS seed_key text;

CREATE UNIQUE INDEX IF NOT EXISTS recurring_expenses_seed_key_unique
  ON public.recurring_expenses (seed_key) WHERE seed_key IS NOT NULL;

UPDATE public.recurring_expenses SET seed_key = lower(regexp_replace(name, '\s+', '_', 'g')) WHERE seed_key IS NULL;
UPDATE public.recurring_expenses SET beneficiary = trim(replace(name, 'Salário', '')) WHERE beneficiary IS NULL AND name LIKE 'Salário%';
