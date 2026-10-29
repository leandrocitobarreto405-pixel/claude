-- Gerente comercial: o lote pode pedir o relatório do período ao terminar (29/10/2026).
-- Só colunas novas numa tabela nova da fase 1; nada existente muda.
ALTER TABLE public.comercial_lotes
  ADD COLUMN IF NOT EXISTS gerar_relatorio boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS relatorio_periodo text CHECK (length(relatorio_periodo) <= 60),
  ADD COLUMN IF NOT EXISTS relatorio_id uuid REFERENCES public.comercial_relatorios(id) ON DELETE SET NULL;
