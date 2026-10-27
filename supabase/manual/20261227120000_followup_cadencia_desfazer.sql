-- Desfaz 20261227120000_followup_cadencia. Antes, desfaça o código: git revert <commit da cadência>
-- (sem force push). Volta o follow-up ao modelo antigo (a Alice agenda cada toque).
BEGIN;
UPDATE public.ia_configuracoes SET cadencia_followup = false, followup_modelos = false, oferta_followup_ligada = false;
-- Toques da cadência ainda pendentes: cancelados (a Alice volta a agendar).
UPDATE public.ia_tarefas SET situacao = 'ignorada', motivo = 'cadência desligada', concluida_em = now()
 WHERE tipo = 'followup' AND situacao = 'pendente' AND dados->>'cadencia' = 'true';
UPDATE public.crm_followups SET status = 'Cancelada', completed_at = now(), result = 'cadência desligada'
 WHERE status = 'Pendente' AND etapa IS NOT NULL;
DROP TRIGGER IF EXISTS trg_whatsapp_messages_followup_respondido ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS private.followup_respondido();
-- As colunas novas ficam (sem uso, não atrapalham).
COMMIT;
