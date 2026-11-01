-- Desfaz a migração 20261228350000_avisos_tatiana (só com OK do usuário): apaga os avisos gravados.
DROP FUNCTION IF EXISTS public.comercial_avisar(uuid, text, text);
DROP TABLE IF EXISTS public.comercial_avisos;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228350000';
