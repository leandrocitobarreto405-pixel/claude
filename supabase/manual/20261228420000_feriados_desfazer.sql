-- Desfaz a migração 20261228420000_feriados (só com OK do usuário e junto com o git revert do
-- merge): apaga o calendário de feriados (e as decisões), as funções e o gatilho.
DROP TRIGGER IF EXISTS trg_empresas_semear_feriados ON public.empresas;
DROP FUNCTION IF EXISTS private.empresas_semear_feriados();
DROP FUNCTION IF EXISTS public.dia_bloqueado(uuid, date);
DROP FUNCTION IF EXISTS public.feriados_semear(uuid, integer);
DROP FUNCTION IF EXISTS private.feriados_padrao(integer);
DROP FUNCTION IF EXISTS private.pascoa(integer);
DROP TABLE IF EXISTS public.feriados;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228420000';
