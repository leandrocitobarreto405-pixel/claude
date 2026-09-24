-- ============ service_items ============
CREATE TABLE public.service_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  upholstery_type_id uuid REFERENCES public.config_options(id),
  description text,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  item_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_items_visit_idx ON public.service_items(visit_id);
CREATE INDEX service_items_group_idx ON public.service_items(item_group_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_items TO authenticated;
GRANT ALL ON public.service_items TO service_role;

ALTER TABLE public.service_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_items_select_staff" ON public.service_items
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "service_items_insert_staff" ON public.service_items
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "service_items_update_staff" ON public.service_items
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "service_items_delete_admin" ON public.service_items
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_service_items_upd BEFORE UPDATE ON public.service_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Migração dos dados atuais: um item por serviço existente.
INSERT INTO public.service_items
  (visit_id, upholstery_type_id, description, quantity, unit_price, subtotal, display_order)
SELECT
  v.id,
  v.upholstery_type_id,
  v.upholstery_description,
  GREATEST(COALESCE(v.item_quantity, 1), 1),
  CASE WHEN GREATEST(COALESCE(v.item_quantity, 1), 1) > 0
       THEN COALESCE(v.final_value, v.visit_value, 0) / GREATEST(COALESCE(v.item_quantity, 1), 1)
       ELSE COALESCE(v.final_value, v.visit_value, 0) END,
  COALESCE(v.final_value, v.visit_value, 0),
  0
FROM public.visits v;

-- ============ work_orders ============
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS items_sum numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS os_value_text text,
  ADD COLUMN IF NOT EXISTS payment_notes text,
  ADD COLUMN IF NOT EXISTS adjustment_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS deletion_reason text;

UPDATE public.work_orders wo
SET items_sum = COALESCE((
  SELECT SUM(COALESCE(v.final_value, v.visit_value, 0))
  FROM public.visits v WHERE v.work_order_id = wo.id AND v.status <> 'Cancelado'
), 0);

-- ============ work_order_history ============
CREATE TABLE public.work_order_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_order_history_wo_idx ON public.work_order_history(work_order_id, created_at DESC);

GRANT SELECT, INSERT ON public.work_order_history TO authenticated;
GRANT ALL ON public.work_order_history TO service_role;

ALTER TABLE public.work_order_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wo_history_select_staff" ON public.work_order_history
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "wo_history_insert_staff" ON public.work_order_history
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "wo_history_delete_admin" ON public.work_order_history
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ motivos de ajuste comercial ============
INSERT INTO public.config_options (kind, name, active, display_order)
SELECT 'adjustment_reason', x.name, true, x.ord
FROM (VALUES
  ('Desconto comercial', 1),
  ('Pacote de serviços', 2),
  ('Negociação com o cliente', 3),
  ('Arredondamento', 4),
  ('Outro', 5)
) AS x(name, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.config_options c WHERE c.kind = 'adjustment_reason' AND c.name = x.name
);