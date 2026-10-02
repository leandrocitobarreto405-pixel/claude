-- Modelos de mensagem editáveis pelo app (aprovado em 02/10/2026).
-- Conexão com a API de gestão de modelos da Meta (WhatsApp Business), registro das edições (para
-- mostrar o limite da Meta: 1 edição por dia e 10 por mês em modelo aprovado) e textos que o Nexa
-- envia sem precisar de aprovação. Só acrescenta tabelas; nada existente muda.

-- ================================================================ 1. conexão com a Meta
-- O que não é segredo: o ID da conta do WhatsApp Business. Só o admin vê; quem grava é o servidor.
CREATE TABLE public.meta_conexoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  waba_id text NOT NULL CHECK (waba_id ~ '^[0-9]{5,25}$'),
  -- Nome da conta devolvido pela Meta na hora de salvar (confirma que o token funciona).
  waba_nome text,
  configurada_em timestamptz NOT NULL DEFAULT now(),
  configurada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.meta_conexoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_conexoes FROM anon, authenticated;
GRANT SELECT ON public.meta_conexoes TO authenticated;
GRANT ALL ON public.meta_conexoes TO service_role;
CREATE POLICY meta_conexoes_select ON public.meta_conexoes FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));

-- O token: ninguém lê pelo app (nem o admin). Só o servidor, com a chave de serviço.
CREATE TABLE public.meta_conexao_segredos (
  empresa_id uuid PRIMARY KEY REFERENCES public.meta_conexoes(empresa_id) ON DELETE CASCADE,
  token text NOT NULL CHECK (length(token) BETWEEN 20 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_conexao_segredos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_conexao_segredos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_conexao_segredos TO service_role;

-- ================================================================ 2. edições feitas pelo app
-- A Meta não informa quantas edições já foram feitas; contamos as que saem do Nexa.
CREATE TABLE public.modelos_edicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  template_id text,
  template_nome text NOT NULL,
  idioma text NOT NULL,
  acao text NOT NULL CHECK (acao IN ('criar', 'editar')),
  -- Situação do modelo na Meta antes da edição (o limite vale para modelo aprovado).
  status_antes text,
  ok boolean NOT NULL,
  erro text,
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_modelos_edicoes_empresa ON public.modelos_edicoes (empresa_id, template_nome, created_at DESC);
ALTER TABLE public.modelos_edicoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.modelos_edicoes FROM anon, authenticated;
GRANT SELECT ON public.modelos_edicoes TO authenticated;
GRANT ALL ON public.modelos_edicoes TO service_role;
CREATE POLICY modelos_edicoes_select ON public.modelos_edicoes FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));

-- ================================================================ 3. textos sem aprovação da Meta
-- Textos que o Nexa envia como mensagem comum (cliente escreveu nas últimas 24 h, avisos da
-- equipe). Sem linha = o texto padrão do app.
CREATE TABLE public.mensagens_textos (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  chave text NOT NULL CHECK (chave ~ '^[a-z0-9_]{1,60}$'),
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 2000),
  atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, chave)
);
ALTER TABLE public.mensagens_textos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mensagens_textos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mensagens_textos TO authenticated;
GRANT ALL ON public.mensagens_textos TO service_role;
CREATE POLICY mensagens_textos_select ON public.mensagens_textos FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE POLICY mensagens_textos_insert ON public.mensagens_textos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE POLICY mensagens_textos_update ON public.mensagens_textos FOR UPDATE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE POLICY mensagens_textos_delete ON public.mensagens_textos FOR DELETE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
