CREATE TABLE public.budget_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  technician_id uuid REFERENCES public.technicians(id),
  sales_origin_id uuid REFERENCES public.config_options(id),
  crm_lead_id uuid REFERENCES public.crm_leads(id),
  scheduled_date date NOT NULL,
  scheduled_time time NOT NULL DEFAULT '09:00',
  status text NOT NULL DEFAULT 'Agendado',
  upholstery_description text,
  notes text,
  visit_fee numeric NOT NULL DEFAULT 0,
  result text,
  result_notes text,
  completed_at timestamptz,
  generated_work_order_id uuid REFERENCES public.work_orders(id),
  mileage_cost_allocated numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_visits TO authenticated;
GRANT ALL ON public.budget_visits TO service_role;

ALTER TABLE public.budget_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read budget visits" ON public.budget_visits
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff can insert budget visits" ON public.budget_visits
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff can update budget visits" ON public.budget_visits
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Admins can delete budget visits" ON public.budget_visits
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_budget_visits_date ON public.budget_visits (scheduled_date);
CREATE INDEX idx_budget_visits_technician ON public.budget_visits (technician_id, scheduled_date);

CREATE TRIGGER trg_budget_visits_upd BEFORE UPDATE ON public.budget_visits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.route_cost_allocations ADD COLUMN budget_visit_id uuid REFERENCES public.budget_visits(id);