ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT,
  ADD COLUMN IF NOT EXISTS parcelas INTEGER,
  ADD COLUMN IF NOT EXISTS taxa_percentual NUMERIC(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custo_taxa NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custo_imposto NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custo_fixo_alocado NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lucro_valor NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS lucro_percentual NUMERIC(6,2);

INSERT INTO public.app_settings (key, value)
VALUES
  ('tax_percent', '6'),
  ('profit_target_percent', '20'),
  ('profit_min_percent', '12.5')
ON CONFLICT (key) DO NOTHING;