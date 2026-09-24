CREATE TABLE public.work_order_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  template_type text NOT NULL,
  google_document_id text,
  google_document_url text,
  document_name text,
  document_version integer NOT NULL DEFAULT 1,
  generation_status text NOT NULL DEFAULT 'Não gerado',
  generated_at timestamp with time zone,
  generated_by uuid REFERENCES auth.users(id),
  source_updated_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  error_message text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_wod_work_order ON public.work_order_documents(work_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_order_documents TO authenticated;
GRANT ALL ON public.work_order_documents TO service_role;

ALTER TABLE public.work_order_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wod_select_staff" ON public.work_order_documents FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "wod_insert_staff" ON public.work_order_documents FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "wod_update_staff" ON public.work_order_documents FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "wod_delete_admin" ON public.work_order_documents FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_wod_upd BEFORE UPDATE ON public.work_order_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS item_quantity integer NOT NULL DEFAULT 1;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS item_unit_label text;