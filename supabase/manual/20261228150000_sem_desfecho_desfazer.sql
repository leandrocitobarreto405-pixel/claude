-- Desfaz 20261228150000_sem_desfecho (aba "Orçamentos sem desfecho").
-- Antes, voltar o código (reverter o merge do E): a tela e a Alice chamam estas funções/colunas.
-- Tira as funções. As colunas novas de crm_leads e os 11 motivos ficam (não apagam nada; os
-- motivos já usados continuam ligados aos leads). Para reabrir um lead encerrado pela aba:
--   UPDATE public.crm_leads SET loss_reason_id = NULL, perdido_em = NULL, is_open = true,
--          closed_at = NULL, desfecho_em = NULL WHERE id = '<lead>';
DROP FUNCTION IF EXISTS public.contar_sem_desfecho();
DROP FUNCTION IF EXISTS public.perdas_por_motivo(date, date, uuid, text);
DROP FUNCTION IF EXISTS public.registrar_desfecho(uuid, uuid, text, date);
DROP FUNCTION IF EXISTS public.motivos_sem_desfecho();
DROP FUNCTION IF EXISTS public.leads_sem_desfecho();
DROP FUNCTION IF EXISTS private.garantir_motivos_sem_desfecho(uuid);
