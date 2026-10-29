-- Desfaz 20261228300000_comercial_relatorio_lote (só com OK).
ALTER TABLE public.comercial_lotes
  DROP COLUMN IF EXISTS gerar_relatorio,
  DROP COLUMN IF EXISTS relatorio_periodo,
  DROP COLUMN IF EXISTS relatorio_id;
