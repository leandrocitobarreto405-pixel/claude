-- Modelos de mensagem: textos novos prontos para o admin revisar antes de enviar para a Meta.
-- 1. modelos_rascunhos: o formulário do modelo (com nome e a versão _sn), por empresa. Nada vai
--    para a Meta sozinho: o rascunho só sai quando o admin toca em enviar, e some depois do envio.
-- 2. Botões novos dos modelos ("Quero aproveitar!", "Me mostre as datas", "Quero renovar",
--    "Quero um orçamento") contam como interesse, igual aos antigos.

-- ================================================================ 1. rascunhos
CREATE TABLE public.modelos_rascunhos (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  template_nome text NOT NULL CHECK (template_nome ~ '^[a-z0-9_]+$' AND length(template_nome) <= 512),
  idioma text NOT NULL DEFAULT 'pt_BR' CHECK (idioma ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  -- Formulário do modelo (nome, categoria, corpo, exemplos, rodapé e botões), como a tela usa.
  form jsonb NOT NULL CHECK (jsonb_typeof(form) = 'object'),
  -- De onde veio, para mostrar na tela (ex.: "textos novos de 04/10").
  origem text,
  atualizado_por uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, template_nome, idioma)
);
ALTER TABLE public.modelos_rascunhos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.modelos_rascunhos FROM anon, authenticated;
GRANT SELECT ON public.modelos_rascunhos TO authenticated;
GRANT ALL ON public.modelos_rascunhos TO service_role;
-- Só o admin da empresa ativa lê; gravar e descartar passam pelo servidor (chave de serviço).
CREATE POLICY modelos_rascunhos_select ON public.modelos_rascunhos FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));

-- ================================================================ 2. botões novos = interesse
ALTER TABLE public.mkt_configuracoes ALTER COLUMN botoes SET DEFAULT '{
    "nao quero mais ofertas": "optout",
    "agora nao": "recusou",
    "ja resolvi": "recusou",
    "tive um problema": "problema",
    "ficou otimo": "elogio",
    "quero ver as datas": "interesse",
    "quero ver horarios": "interesse",
    "quero o valor": "interesse",
    "quero orcamento": "interesse",
    "quero reservar": "interesse",
    "quero aproveitar": "interesse",
    "me mostre as datas": "interesse",
    "quero renovar": "interesse",
    "quero um orcamento": "interesse"
  }';
-- Só acrescenta o que falta (o que a empresa já tiver configurado fica como está).
UPDATE public.mkt_configuracoes
   SET botoes = '{"quero aproveitar": "interesse", "me mostre as datas": "interesse",
                  "quero renovar": "interesse", "quero um orcamento": "interesse"}'::jsonb || botoes
 WHERE NOT (botoes ?& ARRAY['quero aproveitar', 'me mostre as datas', 'quero renovar', 'quero um orcamento']);
