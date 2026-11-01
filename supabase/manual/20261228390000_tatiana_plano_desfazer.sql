-- Desfaz a migração 20261228390000_tatiana_plano (só com OK do usuário): apaga os planos e a função
-- de contagem. As campanhas em rascunho criadas por "Aprovar" ficam no Marketing (apague lá, se quiser).
DROP FUNCTION IF EXISTS public.comercial_listas_contagem(uuid, jsonb);
DROP TABLE IF EXISTS public.comercial_planos;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228390000';
