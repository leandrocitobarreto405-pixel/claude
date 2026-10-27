-- Estorno automático no Google Ads (27/10/2026, aguardando aprovação): venda já exportada que foi
-- cancelada, apagada ou marcada como teste depois ganha o horário da retratação (RETRACT), e a
-- exportação das 5h grava a aba "Ajustes" da planilha. Só colunas novas.
ALTER TABLE public.ads_conversoes_google
  ADD COLUMN IF NOT EXISTS estorno_horario text
    CHECK (estorno_horario IS NULL OR estorno_horario ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$'),
  ADD COLUMN IF NOT EXISTS estorno_exportado_em timestamptz;
