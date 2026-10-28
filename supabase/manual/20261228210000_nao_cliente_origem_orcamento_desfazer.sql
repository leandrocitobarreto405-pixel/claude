-- Desfaz 20261228210000_nao_cliente_origem_orcamento. Antes, tire os leads dos dois motivos novos
-- (UPDATE crm_leads SET loss_reason_id = NULL ... nos leads marcados), senão o DELETE falha.
BEGIN;
DELETE FROM public.config_options
 WHERE kind = 'crm_loss_reason' AND name IN ('Não é cliente', 'Cliente antigo / pós-venda')
   AND (metadata->>'nao_conta')::boolean IS TRUE;
DROP FUNCTION IF EXISTS private.garantir_motivos_nao_conta(uuid);
ALTER TABLE public.whatsapp_contacts
  DROP COLUMN IF EXISTS nao_cliente_em, DROP COLUMN IF EXISTS nao_cliente_motivo,
  DROP COLUMN IF EXISTS nao_cliente_por;
ALTER TABLE public.crm_leads DROP COLUMN IF EXISTS orcamento_origem;
COMMIT;
-- A função private.garantir_motivos_sem_desfecho volta a ser a de 20261228150000 (rode o
-- CREATE OR REPLACE de lá) se quiser tirar a chamada aos motivos novos.
