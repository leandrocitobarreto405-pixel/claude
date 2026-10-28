-- Desfaz 20261228270000_toque_d1_audio (os toques já gravados como "audio" viram "texto").
UPDATE public.crm_followups SET canal = 'texto' WHERE canal = 'audio';
ALTER TABLE public.crm_followups DROP CONSTRAINT IF EXISTS crm_followups_canal_check;
ALTER TABLE public.crm_followups ADD CONSTRAINT crm_followups_canal_check
  CHECK (canal IS NULL OR canal IN ('texto', 'modelo', 'equipe'));
ALTER TABLE public.ia_configuracoes DROP COLUMN IF EXISTS toque_d1_audio;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228270000';
