-- Desfaz 20261228180000_push_recibo. Antes, reverter o código (sw.js e envio usam as funções).
-- As colunas novas ficam (não apagam nada).
DROP FUNCTION IF EXISTS public.push_confirmar_recibo(uuid);
DROP FUNCTION IF EXISTS public.push_registrar_envio(uuid, integer);
