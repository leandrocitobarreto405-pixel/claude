ALTER TABLE public.technicians
  ADD COLUMN IF NOT EXISTS base_latitude numeric,
  ADD COLUMN IF NOT EXISTS base_longitude numeric;