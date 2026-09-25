CREATE TABLE public.technician_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id uuid REFERENCES public.technicians(id),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  categories text[] NOT NULL DEFAULT '{}',
  amount numeric NOT NULL DEFAULT 0,
  work_order_id uuid REFERENCES public.work_orders(id),
  notes text,
  expense_id uuid REFERENCES public.expenses(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_technician_expenses_date ON public.technician_expenses (expense_date);
CREATE INDEX idx_technician_expenses_tech ON public.technician_expenses (technician_id, expense_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.technician_expenses TO authenticated;
GRANT ALL ON public.technician_expenses TO service_role;

ALTER TABLE public.technician_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read technician_expenses" ON public.technician_expenses
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff insert technician_expenses" ON public.technician_expenses
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff update technician_expenses" ON public.technician_expenses
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff delete technician_expenses" ON public.technician_expenses
  FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

CREATE TRIGGER trg_technician_expenses_upd BEFORE UPDATE ON public.technician_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
