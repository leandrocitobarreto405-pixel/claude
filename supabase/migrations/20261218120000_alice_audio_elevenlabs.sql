-- Áudio da Alice com a ElevenLabs (nasce desligado; o padrão continua o Google).
-- 1. ia_configuracoes: provedor por empresa (google | elevenlabs), voz da ElevenLabs (voice_id) e
--    modelo (eleven_flash_v2_5, mais barato | eleven_v4, melhor qualidade). A voz do Google
--    (audio_voz) fica como reserva: se a ElevenLabs recusar (ex.: 429), aquele áudio sai pelo Google.
-- 2. ia_audios_uso: provedor, modelo e aviso (ex.: "ElevenLabs recusou; foi pelo Google").
-- 3. Preço da ElevenLabs (US$ por mil créditos, plano da conta da Nexa), editável pela Nexa.
ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS audio_provedor text NOT NULL DEFAULT 'google'
    CHECK (audio_provedor IN ('google', 'elevenlabs')),
  ADD COLUMN IF NOT EXISTS audio_eleven_voz text
    CHECK (audio_eleven_voz IS NULL OR audio_eleven_voz ~ '^[A-Za-z0-9]{12,40}$'),
  ADD COLUMN IF NOT EXISTS audio_eleven_modelo text NOT NULL DEFAULT 'eleven_flash_v2_5'
    CHECK (audio_eleven_modelo IN ('eleven_flash_v2_5', 'eleven_v4'));

ALTER TABLE public.ia_audios_uso
  ADD COLUMN IF NOT EXISTS provedor text NOT NULL DEFAULT 'google'
    CHECK (provedor IN ('google', 'elevenlabs')),
  ADD COLUMN IF NOT EXISTS modelo text,
  ADD COLUMN IF NOT EXISTS aviso text;

INSERT INTO public.configuracoes_plataforma (chave, valor, descricao) VALUES
  ('elevenlabs_usd_por_mil_creditos', '0.22',
   'ElevenLabs: US$ por mil créditos no plano da conta da Nexa (custo dos áudios da Alice)')
ON CONFLICT (chave) DO NOTHING;
