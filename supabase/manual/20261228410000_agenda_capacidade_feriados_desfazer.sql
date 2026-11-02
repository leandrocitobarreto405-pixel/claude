-- Desfaz a migração 20261228410000_agenda_capacidade_feriados (só com OK do usuário).
-- Apaga o calendário de feriados (e as decisões), as funções e as colunas novas. O app publicado
-- antes desta migração não usa nada disto; o app publicado depois precisa voltar junto
-- (git revert do merge).
DROP TRIGGER IF EXISTS trg_empresas_semear_feriados ON public.empresas;
DROP FUNCTION IF EXISTS private.empresas_semear_feriados();
DROP FUNCTION IF EXISTS public.dia_bloqueado(uuid, date);
DROP FUNCTION IF EXISTS public.feriados_semear(uuid, integer);
DROP FUNCTION IF EXISTS private.feriados_padrao(integer);
DROP FUNCTION IF EXISTS private.pascoa(integer);
DROP TABLE IF EXISTS public.feriados;
ALTER TABLE public.agenda_configuracoes DROP COLUMN IF EXISTS dia_inteiro_valor;
ALTER TABLE public.visits DROP COLUMN IF EXISTS ocupa_dia;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228410000';
