-- Desfaz 20261228170000_google_estorno. Antes, reverter o código do estorno. As colunas ficam
-- (não apagam nada); a aba "Ajustes" da planilha pode ser apagada à mão se ainda não estiver
-- ligada a uma conexão do Google Ads. Retratação que o Google já leu não volta atrás.
UPDATE public.ads_conversoes_google SET estorno_horario = NULL WHERE estorno_exportado_em IS NULL;
