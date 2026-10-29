-- Desfaz 20261228290000_gerente_comercial (só com OK). Apaga as fichas, lotes e relatórios do
-- gerente comercial (dados derivados; os leads não mudam, exceto os desfechos já confirmados por
-- clique, que ficam como estão) e volta o nome do motivo "Agenda cheia".
DROP FUNCTION IF EXISTS public.comercial_confirmar_perda(uuid, uuid, text, date);
DROP FUNCTION IF EXISTS public.comercial_nao_perdeu(uuid);
DROP TABLE IF EXISTS public.comercial_analises;
DROP TABLE IF EXISTS public.comercial_relatorios;
DROP TABLE IF EXISTS public.comercial_lotes;
DROP TABLE IF EXISTS public.comercial_configuracoes;
DROP FUNCTION IF EXISTS public.marcar_encaixe(uuid, boolean, text);
DROP INDEX IF EXISTS public.idx_crm_leads_encaixe;
ALTER TABLE public.crm_leads
  DROP COLUMN IF EXISTS encaixe_pedido_em,
  DROP COLUMN IF EXISTS encaixe_obs,
  DROP COLUMN IF EXISTS encaixe_por;
UPDATE public.config_options SET name = 'Agenda cheia'
 WHERE kind = 'crm_loss_reason' AND name = 'Agenda cheia / sem manhã livre';
-- private.garantir_motivos_sem_desfecho e public.perdas_por_motivo: reaplicar as versões de
-- 20261228210000_nao_cliente_origem_orcamento.sql e 20261228150000_sem_desfecho.sql (o relatório
-- novo aceita os dois nomes, então pode ficar).
