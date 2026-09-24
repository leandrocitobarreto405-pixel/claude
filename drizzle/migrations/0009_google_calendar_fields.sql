ALTER TABLE public.technicians ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS google_event_id text;
ALTER TABLE public.budget_visits ADD COLUMN IF NOT EXISTS google_event_id text;