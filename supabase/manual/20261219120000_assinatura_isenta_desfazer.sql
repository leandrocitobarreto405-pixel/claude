-- Desfaz a isenção (depois do git revert do código). A Turbine volta a não ter marcação de isenta
-- (como antes, a Interna é R$ 0 e já não gera fatura nem atraso).
UPDATE public.assinaturas SET isenta = false, isenta_em = NULL, isenta_por = NULL WHERE isenta;
DROP TRIGGER IF EXISTS trg_assinaturas_herdar_isencao ON public.assinaturas;
DROP FUNCTION IF EXISTS private.assinaturas_herdar_isencao();
DROP FUNCTION IF EXISTS public.definir_cobranca(uuid, boolean, boolean, date);
DROP FUNCTION IF EXISTS public.situacao_cobranca_empresas();
-- private.assinaturas_sem_mensalidade, private.faturas_conferir e private.empresa_situacao: com
-- isenta = false em todas, se comportam como antes. As colunas isenta/isenta_em/isenta_por ficam.
