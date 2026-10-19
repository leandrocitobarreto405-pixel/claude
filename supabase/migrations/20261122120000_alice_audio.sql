-- Alice responde em áudio (aprovada em 19/10/2026). Só acréscimos, tudo desligado:
--  * ia_configuracoes: resposta em áudio (desligada), voz, limites (350 caracteres, 25 s,
--    R$ 5,00 por dia) e a cotação usada na estimativa (US$ 1 = R$ 5,50).
--  * conversas.alice_so_texto_em: o cliente pediu "manda por escrito" (a Alice para de usar áudio
--    naquela conversa).
--  * ia_audios_uso: cada áudio gerado (enviado, falhou ou teste da tela de vozes), com o texto
--    falado, caracteres, segundos e custo estimado. Leitura só da própria empresa; quem grava é o
--    servidor.
-- Nada é apagado e nenhum dado existente muda.

ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS audio_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS audio_voz text,
  ADD COLUMN IF NOT EXISTS audio_max_caracteres integer NOT NULL DEFAULT 350,
  ADD COLUMN IF NOT EXISTS audio_max_segundos integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS audio_limite_diario_reais numeric(10,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS audio_cotacao_dolar numeric(6,2) NOT NULL DEFAULT 5.50;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_configuracoes_audio_limites') THEN
    ALTER TABLE public.ia_configuracoes ADD CONSTRAINT ia_configuracoes_audio_limites CHECK (
      audio_max_caracteres BETWEEN 50 AND 1500
      AND audio_max_segundos BETWEEN 5 AND 120
      AND audio_limite_diario_reais >= 0
      AND audio_cotacao_dolar > 0
      AND (audio_voz IS NULL OR audio_voz ~ '^pt-BR-Chirp3-HD-[A-Za-z]+$')
      AND (NOT audio_ativo OR audio_voz IS NOT NULL)
    );
  END IF;
END $$;

ALTER TABLE public.conversas ADD COLUMN IF NOT EXISTS alice_so_texto_em timestamptz;

CREATE TABLE IF NOT EXISTS public.ia_audios_uso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
  chatwoot_message_id bigint,
  voz text NOT NULL,
  situacao text NOT NULL CHECK (situacao IN ('enviado', 'falhou', 'teste')),
  caracteres integer NOT NULL DEFAULT 0 CHECK (caracteres >= 0),
  segundos numeric(7,2),
  custo_reais numeric(10,4) NOT NULL DEFAULT 0 CHECK (custo_reais >= 0),
  texto_falado text NOT NULL DEFAULT '',
  erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ia_audios_uso_empresa ON public.ia_audios_uso (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ia_audios_uso_conversa ON public.ia_audios_uso (conversa_id);
CREATE INDEX IF NOT EXISTS idx_ia_audios_uso_mensagem
  ON public.ia_audios_uso (empresa_id, chatwoot_message_id) WHERE chatwoot_message_id IS NOT NULL;
ALTER TABLE public.ia_audios_uso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ia_audios_uso FROM anon, authenticated;
GRANT SELECT ON public.ia_audios_uso TO authenticated;
GRANT ALL ON public.ia_audios_uso TO service_role;
CREATE POLICY ia_audios_uso_select ON public.ia_audios_uso FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE TRIGGER trg_ia_audios_uso_valida_empresa BEFORE INSERT OR UPDATE ON public.ia_audios_uso
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('conversa_id', 'conversas');
