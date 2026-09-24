ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason text,
  ADD COLUMN IF NOT EXISTS discount_notes text,
  ADD COLUMN IF NOT EXISTS discount_at timestamptz,
  ADD COLUMN IF NOT EXISTS discount_by uuid;