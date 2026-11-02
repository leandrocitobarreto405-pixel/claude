-- Desfaz a migração 20261228410000_agenda_capacidade (só com OK do usuário e junto com o
-- git revert do merge: o app publicado depois dela lê estas colunas).
ALTER TABLE public.agenda_configuracoes DROP COLUMN IF EXISTS dia_inteiro_valor;
ALTER TABLE public.visits DROP COLUMN IF EXISTS ocupa_dia;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228410000';
