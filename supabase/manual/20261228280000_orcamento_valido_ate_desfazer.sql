-- Desfaz 20261228280000_orcamento_valido_ate (as garantias gravadas se perdem: confira antes com
-- SELECT id, valido_ate FROM public.quotes WHERE valido_ate IS NOT NULL).
ALTER TABLE public.quotes DROP COLUMN IF EXISTS valido_ate;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228280000';
