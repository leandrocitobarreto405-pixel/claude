-- Desfaz 20261228160000_google_conversoes_leads (conversões otimizadas para leads na planilha).
-- Antes, voltar o código da exportação (reverter o commit do exportador): o código novo lê a visão
-- e grava na tabela. A planilha volta ao formato antigo (5 colunas, só gclid) na próxima exportação.
-- A tabela guarda só o registro do que foi exportado (sem e-mail/telefone em claro); apagar não
-- muda nada no Google Ads (o que ele já importou continua lá).
DROP VIEW IF EXISTS public.vw_conversoes_google_candidatas;
DROP TABLE IF EXISTS public.ads_conversoes_google;
