ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS preencher_agenda boolean NOT NULL DEFAULT false;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS contribuicao_valor numeric;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS contribuicao_percentual numeric;

INSERT INTO public.app_settings (key, value)
VALUES
  ('services_per_month_estimate', '34'::jsonb),
  ('contribution_min_percent', '70'::jsonb),
  ('contribution_warn_percent', '60'::jsonb)
ON CONFLICT (key) DO NOTHING;