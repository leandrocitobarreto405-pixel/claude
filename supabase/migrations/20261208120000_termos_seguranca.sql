-- Fase B, item 8 (decisões C e H): aceite dos termos e ajustes de segurança.
-- 1. public.termos_aceites: quem aceitou ("li e aceito"), quando, de qual IP e navegador, e qual
--    versão. Cada pessoa vê os próprios; a Nexa vê todos; quem grava é o servidor (o IP vem do
--    pedido, nunca da tela). empresa_id = empresa aberta no aceite (vazio para quem ainda não tem).
-- 2. configuracoes_plataforma: termos_versao e termos_url começam vazios (null). Enquanto a Nexa
--    não preencher a versão no Painel Nexa, ninguém é perguntado. Versão nova = todos aceitam de novo.
-- 3. private.validar_proximo_numero_os com search_path fixo (aviso do Supabase).
-- Nenhum dado existente muda.

CREATE TABLE IF NOT EXISTS public.termos_aceites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  versao text NOT NULL CHECK (length(btrim(versao)) BETWEEN 1 AND 40),
  aceito_em timestamptz NOT NULL DEFAULT now(),
  ip text,
  navegador text CHECK (navegador IS NULL OR length(navegador) <= 500),
  UNIQUE (user_id, versao)
);
CREATE INDEX IF NOT EXISTS idx_termos_aceites_versao ON public.termos_aceites (versao, aceito_em DESC);
ALTER TABLE public.termos_aceites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.termos_aceites FROM anon, authenticated;
GRANT SELECT ON public.termos_aceites TO authenticated;
GRANT ALL ON public.termos_aceites TO service_role;
DROP POLICY IF EXISTS termos_aceites_select ON public.termos_aceites;
CREATE POLICY termos_aceites_select ON public.termos_aceites FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT private.is_nexa_admin()));

INSERT INTO public.configuracoes_plataforma (chave, valor, descricao) VALUES
  ('termos_versao', 'null', 'Versão vigente dos termos de uso e privacidade (vazio: ninguém é perguntado)'),
  ('termos_url', 'null', 'Link do documento dos termos de uso e privacidade')
ON CONFLICT (chave) DO NOTHING;

ALTER FUNCTION private.validar_proximo_numero_os() SET search_path = public;

-- Trava de somente leitura (tabela com empresa_id; só o servidor grava nela).
SELECT private.instalar_travas_somente_leitura();
