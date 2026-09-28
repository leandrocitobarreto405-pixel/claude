-- =====================================================================================
-- Nexa OS — Conta Google por empresa (Drive, Docs e Agenda)
--
-- Substitui o conector do Lovable. Cada empresa conecta a própria conta Google em
-- Configurações (OAuth); o app usa essa conta para copiar os modelos da OS, criar as pastas,
-- compartilhar com o cliente e lançar os eventos na agenda.
--
--  * google_conexoes: conta conectada (e-mail, permissões concedidas, situação). A empresa lê a
--    sua; só o servidor (chave de serviço) grava, no retorno da autorização do Google.
--  * google_conexao_segredos: token de renovação. Nenhum usuário lê; só a chave de serviço.
-- =====================================================================================

CREATE TABLE public.google_conexoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  email text,
  escopos text[] NOT NULL DEFAULT '{}',
  situacao text NOT NULL DEFAULT 'conectada' CHECK (situacao IN ('conectada', 'erro')),
  erro text,
  conectado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  conectado_em timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_google_conexoes_conectado_por ON public.google_conexoes (conectado_por);
ALTER TABLE public.google_conexoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_conexoes FROM anon, authenticated;
GRANT SELECT ON public.google_conexoes TO authenticated;
GRANT ALL ON public.google_conexoes TO service_role;
CREATE POLICY google_conexoes_select ON public.google_conexoes FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE TRIGGER trg_google_conexoes_upd BEFORE UPDATE ON public.google_conexoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.google_conexao_segredos (
  empresa_id uuid PRIMARY KEY REFERENCES public.google_conexoes(empresa_id) ON DELETE CASCADE,
  refresh_token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_conexao_segredos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_conexao_segredos FROM anon, authenticated;
GRANT ALL ON public.google_conexao_segredos TO service_role;
CREATE POLICY google_conexao_segredos_sem_acesso ON public.google_conexao_segredos
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
