-- Caixa de entrada, item 3: assumir conversas e não lidas.
--
-- 1. usuarios_empresa.chatwoot_agent_id: quem é cada pessoa no Chatwoot (escolhido em Equipe e
--    acessos). Com isso "Minhas" = conversas que eu assumi pelo app OU que estão atribuídas a mim
--    no Chatwoot, e assumir pelo app também atribui no Chatwoot quando a pessoa tem usuário lá.
-- 2. conversas.assumida_por / assumida_em: quem assumiu pelo app e quando.
-- 3. conversas_leituras: até quando cada pessoa leu cada conversa (não lidas = mensagens do
--    cliente depois disso). Uma linha por pessoa e conversa; cada um só vê e grava as suas.
-- Só acrescenta; nada é apagado nem alterado.
ALTER TABLE public.usuarios_empresa ADD COLUMN IF NOT EXISTS chatwoot_agent_id bigint;

ALTER TABLE public.conversas
  ADD COLUMN IF NOT EXISTS assumida_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assumida_em timestamptz;
CREATE INDEX IF NOT EXISTS idx_conversas_assumida_por ON public.conversas (empresa_id, assumida_por)
  WHERE assumida_por IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.conversas_leituras (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL REFERENCES public.conversas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lida_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversa_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conversas_leituras_pessoa ON public.conversas_leituras (empresa_id, user_id);
ALTER TABLE public.conversas_leituras ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversas_leituras TO authenticated;
GRANT ALL ON public.conversas_leituras TO service_role;
-- Cada pessoa só enxerga e grava as próprias leituras, na empresa ativa.
CREATE POLICY conversas_leituras_proprias ON public.conversas_leituras FOR ALL TO authenticated
  USING (user_id = auth.uid() AND empresa_id = (SELECT private.empresa_ativa()))
  WITH CHECK (user_id = auth.uid() AND empresa_id = (SELECT private.empresa_ativa()));
CREATE TRIGGER trg_conversas_leituras_valida_empresa BEFORE INSERT OR UPDATE ON public.conversas_leituras
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('conversa_id', 'conversas');
