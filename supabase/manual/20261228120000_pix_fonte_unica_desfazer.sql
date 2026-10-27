-- Desfaz 20261228120000_pix_fonte_unica: tira os gatilhos (as colunas antigas voltam a ser
-- independentes, com os valores de hoje). Antes, desfaça o código: git revert do merge do Pix
-- (sem force push). Valor antigo do campo da vitrine na Turbine: 10 (não usado com a vitrine
-- desligada); para voltar: UPDATE public.orcamento_configuracoes SET pix_pct = 10 WHERE empresa_id =
-- '11111111-1111-1111-1111-111111111111'; (rode DEPOIS de tirar os gatilhos).
BEGIN;
DROP TRIGGER IF EXISTS trg_orcamento_configuracoes_pix ON public.orcamento_configuracoes;
DROP TRIGGER IF EXISTS trg_ia_configuracoes_pix ON public.ia_configuracoes;
DROP TRIGGER IF EXISTS trg_agenda_configuracoes_pix ON public.agenda_configuracoes;
DROP FUNCTION IF EXISTS private.pix_copiar_da_fonte();
DROP FUNCTION IF EXISTS private.pix_seguir_fonte();
COMMIT;
