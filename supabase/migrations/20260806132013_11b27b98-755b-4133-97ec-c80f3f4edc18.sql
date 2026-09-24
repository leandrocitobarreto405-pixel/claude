ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS collection_rule text NOT NULL DEFAULT 'split_by_service',
  ADD COLUMN IF NOT EXISTS collection_visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_instruction text,
  ADD COLUMN IF NOT EXISTS collection_configuration_updated_at timestamptz;

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS reschedule_type text,
  ADD COLUMN IF NOT EXISTS technician_travel_occurred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preserve_original_route boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rescheduled_from_visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_to_visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reschedule_reason text,
  ADD COLUMN IF NOT EXISTS reschedule_notes text,
  ADD COLUMN IF NOT EXISTS original_scheduled_date date,
  ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS rescheduled_by uuid;

CREATE INDEX IF NOT EXISTS visits_rescheduled_from_idx ON public.visits(rescheduled_from_visit_id);
CREATE INDEX IF NOT EXISTS visits_rescheduled_to_idx ON public.visits(rescheduled_to_visit_id);