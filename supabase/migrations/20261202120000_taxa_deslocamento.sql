-- Taxa de deslocamento por faixa de valor (pedido de 22/10/2026). Só acrescenta; nada liga sozinho.
-- 1. orcamento_configuracoes.distancia_faixas: [{"ate": 500, "pct": 20}, {"ate": 1000, "pct": 10},
--    {"ate": null, "pct": 0}] — o % da taxa depende da soma dos itens. Vazio: vale distancia_pct.
-- 2. quotes: a taxa pela regra e quem alterou ou tirou a taxa (acrescimo_distancia é a cobrada).
-- 3. work_orders: a taxa da OS (linha "Taxa de deslocamento"), a da regra e quem alterou ou tirou.

ALTER TABLE public.orcamento_configuracoes
  ADD COLUMN IF NOT EXISTS distancia_faixas jsonb;
DO $$
BEGIN
  ALTER TABLE public.orcamento_configuracoes ADD CONSTRAINT orcamento_configuracoes_distancia_faixas_check
    CHECK (distancia_faixas IS NULL OR jsonb_typeof(distancia_faixas) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS acrescimo_distancia_regra numeric(10,2),
  ADD COLUMN IF NOT EXISTS acrescimo_distancia_editado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acrescimo_distancia_editado_em timestamptz;

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS taxa_deslocamento numeric(10,2),
  ADD COLUMN IF NOT EXISTS taxa_deslocamento_regra numeric(10,2),
  ADD COLUMN IF NOT EXISTS taxa_deslocamento_editada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS taxa_deslocamento_editada_em timestamptz;
