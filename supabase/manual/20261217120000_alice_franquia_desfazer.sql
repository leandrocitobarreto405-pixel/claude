-- Desfaz 20261217120000_alice_franquia (depois do git revert do código, que chama estas funções).
-- A Alice volta a responder sem franquia; o histórico de uso do mês é apagado.
DROP TRIGGER IF EXISTS trg_ia_execucoes_uso ON public.ia_execucoes;
DROP FUNCTION IF EXISTS public.alice_conversas_caras(date, integer);
DROP FUNCTION IF EXISTS public.alice_franquia_empresas(date);
DROP FUNCTION IF EXISTS public.alice_uso_do_mes();
DROP FUNCTION IF EXISTS public.alice_pode_responder(uuid, uuid);
DROP FUNCTION IF EXISTS private.alice_contar_uso();
DROP FUNCTION IF EXISTS private.alice_aviso_franquia(uuid, date, text, text, text);
DROP FUNCTION IF EXISTS private.alice_franquia(uuid);
DROP TABLE IF EXISTS public.alice_uso_mensal;
DELETE FROM public.configuracoes_plataforma WHERE chave IN ('alice_cotacao_dolar', 'alice_teto_custo_conversa_reais');
-- Colunas novas (planos.alice_*, ia_configuracoes.continuar_apos_franquia/teto_excedente_reais)
-- ficam: não atrapalham o código antigo. private.mes_sp e private.config_numero também ficam.
DELETE FROM supabase_migrations.schema_migrations WHERE name = 'alice_franquia';
