-- Toque do dia seguinte (D1 10h) em áudio (28/10, item 5): liga/desliga por empresa (desligado por
-- padrão). Dentro da janela de 24 h, o toque A3/B3 sai falado (falar_em_audio); fora dela, o modelo
-- aprovado em texto, como antes. O follow-up guarda o canal "audio" para comparar áudio × texto.
ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS toque_d1_audio boolean NOT NULL DEFAULT false;

ALTER TABLE public.crm_followups DROP CONSTRAINT IF EXISTS crm_followups_canal_check;
ALTER TABLE public.crm_followups ADD CONSTRAINT crm_followups_canal_check
  CHECK (canal IS NULL OR canal IN ('texto', 'modelo', 'equipe', 'audio'));
