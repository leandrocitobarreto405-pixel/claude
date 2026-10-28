-- Desfaz 20261228230000_temperatura_por_eventos. A temperatura volta a ser a da IA (QUENTE/FRIO);
-- quem estiver MORNO vira FRIO. Antes, publique o código sem a varredura da temperatura.
BEGIN;
DROP FUNCTION IF EXISTS public.crm_recalcular_temperaturas();
DROP FUNCTION IF EXISTS public.crm_temperatura_para_ler_contexto(integer);
DROP FUNCTION IF EXISTS private.crm_temperatura_calculada();
UPDATE public.crm_leads SET temperature = CASE WHEN temperatura_ia = 'QUENTE' THEN 'QUENTE' ELSE 'FRIO' END
 WHERE NOT temperature_confirmed AND temperatura_ia IS NOT NULL;
UPDATE public.crm_leads SET temperature = 'FRIO' WHERE temperature = 'MORNO';
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_temperature_valores;
DROP TRIGGER IF EXISTS trg_crm_leads_upd_temperatura ON public.crm_leads;
DROP FUNCTION IF EXISTS private.crm_leads_temperatura_sem_updated_at();
ALTER TABLE public.crm_leads
  DROP COLUMN IF EXISTS temperatura_ia, DROP COLUMN IF EXISTS temperatura_motivo,
  DROP COLUMN IF EXISTS retorno_combinado_em, DROP COLUMN IF EXISTS contexto_classe,
  DROP COLUMN IF EXISTS contexto_lido_em;
COMMIT;
