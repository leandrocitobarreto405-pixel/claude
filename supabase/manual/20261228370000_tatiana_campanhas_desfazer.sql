-- Desfaz a migração 20261228370000_tatiana_campanhas (só com OK do usuário): apaga o acompanhamento.
DROP TABLE IF EXISTS public.comercial_campanhas;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228370000';
