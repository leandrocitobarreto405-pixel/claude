-- Origem Site x Blog e cupons de desconto (Turbine, aprovado em 19/10/2026).
--  1) Textos do site WordPress e do blog como mensagens prontas (mensagens_origem): a primeira
--     mensagem do lead que contém um deles dá a origem (Site (orgânico) ou Blog) e o serviço.
--  2) Regra de reserva: palavra-chave terminada em "*" vale como começo de palavra ("cupom site*"
--     pega "cupom SITE50"). Blog: "blog" (já existia; cobre "no blog" e "do blog") + "cupom
--     blog*"; Site: "cupom site*". Palavras só preenchem origem vazia: nunca trocam origem de
--     gclid, landing ou campanha (e o texto cadastrado vem antes delas).
--  3) Cupons por empresa (valor em R$ e serviço), usados pela Alice no orçamento; o orçamento
--     guarda o código em quotes.cupom (o desconto vai como "manual", com o valor em reais).
-- Nada é apagado.

-- ---------------------------------------------------------------- 0) origens (Turbine), se faltarem
INSERT INTO public.config_options (empresa_id, kind, name, active, display_order, metadata)
SELECT e.id, 'sales_origin', v.nome, true, v.ordem,
       jsonb_build_object('codigo', v.codigo, 'palavras', v.palavras::jsonb)
  FROM public.empresas e
 CROSS JOIN (VALUES ('Blog', 'blog', 5, '["blog"]'), ('Site (orgânico)', 'site', 8, '[]')) v(nome, codigo, ordem, palavras)
 WHERE e.id = '11111111-1111-1111-1111-111111111111'
   AND NOT EXISTS (SELECT 1 FROM public.config_options o
                    WHERE o.empresa_id = e.id AND o.kind = 'sales_origin'
                      AND (o.name = v.nome OR o.metadata->>'codigo' = v.codigo));

-- ---------------------------------------------------------------- 1) mensagens prontas
INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id, servico, descricao)
SELECT o.empresa_id, v.texto, o.id, v.servico, v.descricao
  FROM (VALUES
    ('site', 'Olá! Quero higienizar meu estofado com R$50 de desconto (cupom SITE50).', 'Higienização', 'Site — cupom SITE50'),
    ('site', 'Olá! Quero impermeabilizar meu estofado com R$82 de desconto (cupom SITE82).', 'Impermeabilização', 'Site — cupom SITE82'),
    ('site', 'Olá! Quero um orçamento de limpeza de tapete.', 'Tapete', 'Site — página de tapetes'),
    ('site', 'Olá! Quero um orçamento de limpeza de persianas.', 'Persiana', 'Site — página de persianas'),
    ('blog', 'Olá, vim do blog e gostaria de solicitar um orçamento!', NULL, 'Blog — botão geral'),
    ('blog', 'Olá! Vi a tabela de preços de sofá no blog e quero um orçamento.', 'Higienização', 'Blog — tabela de preços de sofá'),
    ('blog', 'Olá! Vi a tabela de preços de colchão no blog e quero um orçamento.', 'Higienização', 'Blog — tabela de preços de colchão'),
    ('blog', 'Olá! Vi no blog sobre lavagem de colchão e quero um orçamento.', 'Higienização', 'Blog — lavagem de colchão'),
    ('blog', 'Olá! Vi o post sobre cama box e pillow top no blog e quero um orçamento.', 'Higienização', 'Blog — cama box e pillow top'),
    ('blog', 'Olá! Vi o post sobre impermeabilização de colchão no blog e quero um orçamento de higienização.', 'Higienização', 'Blog — impermeabilização de colchão'),
    ('blog', 'Olá! Vi o post sobre colchão sujo no blog e quero um orçamento.', 'Higienização', 'Blog — colchão sujo'),
    ('blog', 'Olá! Vi o post sobre lavar sofá em casa no blog e quero um orçamento.', 'Higienização', 'Blog — lavar sofá em casa'),
    ('blog', 'Olá! Vi o post sobre limpeza de persianas no blog e quero um orçamento.', 'Persiana', 'Blog — limpeza de persianas')
  ) v(codigo, texto, servico, descricao)
  JOIN public.config_options o
    ON o.empresa_id = '11111111-1111-1111-1111-111111111111' AND o.kind = 'sales_origin'
   AND o.active AND o.metadata->>'codigo' = v.codigo
 WHERE NOT EXISTS (SELECT 1 FROM public.mensagens_origem m
                    WHERE m.empresa_id = o.empresa_id
                      AND private.texto_busca(m.texto) = private.texto_busca(v.texto));

-- ---------------------------------------------------------------- 2) reserva
-- Mesma função de 20261001120000; só a comparação das palavras aceita o "*" final.
CREATE OR REPLACE FUNCTION private.identificar_origem_lead(
  _empresa_id uuid, _texto text, _canal text, _eh_cliente boolean, _atributos jsonb
) RETURNS TABLE (origem uuid, campanha uuid, servico text)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  codigo text;
  txt text := private.texto_busca(_texto);
  anuncio text := lower(coalesce(_atributos::text, ''));
  msg_origem uuid;
  r record;
BEGIN
  IF length(trim(txt)) > 0 THEN
    SELECT m.sales_origin_id, m.campaign_id, m.servico INTO msg_origem, campanha, servico
      FROM public.mensagens_origem m
     WHERE m.empresa_id = _empresa_id AND m.ativo
       AND position(private.texto_busca(m.texto) IN txt) > 0
     ORDER BY length(private.texto_busca(m.texto)) DESC, m.created_at
     LIMIT 1;
  END IF;

  IF _eh_cliente THEN
    codigo := 'cliente_existente';
  ELSIF _canal = 'Channel::Instagram' THEN
    codigo := 'instagram';
  ELSIF _canal = 'Channel::FacebookPage' THEN
    codigo := 'facebook';
  ELSIF anuncio LIKE '%instagram%' THEN
    codigo := 'instagram';
  ELSIF anuncio LIKE '%facebook%' OR anuncio LIKE '%fb.me%' OR anuncio LIKE '%ctwa%' THEN
    codigo := 'facebook';
  END IF;

  IF codigo IS NOT NULL THEN
    origem := (SELECT o.id FROM public.config_options o
                WHERE o.empresa_id = _empresa_id AND o.kind = 'sales_origin' AND o.active
                  AND o.metadata->>'codigo' = codigo
                ORDER BY o.display_order LIMIT 1);
  END IF;
  origem := coalesce(origem, msg_origem);

  IF origem IS NULL AND length(trim(txt)) > 0 THEN
    FOR r IN
      SELECT o.id, o.metadata->'palavras' AS palavras FROM public.config_options o
       WHERE o.empresa_id = _empresa_id AND o.kind = 'sales_origin' AND o.active
         AND jsonb_typeof(o.metadata->'palavras') = 'array'
       ORDER BY o.display_order, o.name
    LOOP
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(r.palavras) w
         WHERE length(trim(private.texto_busca(w))) > 0
           AND position(CASE WHEN right(trim(w), 1) = '*'
                             THEN rtrim(private.texto_busca(rtrim(trim(w), '*')))
                             ELSE private.texto_busca(w) END IN txt) > 0
      ) THEN
        origem := r.id;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  RETURN NEXT;
END $$;

UPDATE public.config_options o
   SET metadata = jsonb_set(o.metadata, '{palavras}',
         coalesce(o.metadata->'palavras', '[]'::jsonb) || to_jsonb(v.palavra))
  FROM (VALUES ('site', 'cupom site*'), ('blog', 'cupom blog*')) v(codigo, palavra)
 WHERE o.empresa_id = '11111111-1111-1111-1111-111111111111' AND o.kind = 'sales_origin'
   AND o.metadata->>'codigo' = v.codigo
   AND NOT coalesce(o.metadata->'palavras', '[]'::jsonb) ? v.palavra;

-- ---------------------------------------------------------------- 3) cupons
CREATE TABLE IF NOT EXISTS public.cupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL DEFAULT private.empresa_ativa() REFERENCES public.empresas(id),
  codigo text NOT NULL CHECK (codigo ~ '^[A-Z0-9]{3,30}$'),
  valor numeric(10,2) NOT NULL CHECK (valor > 0),
  servico text NOT NULL CHECK (servico IN ('higienizacao', 'impermeabilizacao')),
  -- Cupons do mesmo canal (ex.: BLOG) são oferecidos no lugar um do outro.
  canal text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cupons_codigo_key ON public.cupons (empresa_id, codigo);
ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.cupons TO authenticated;
GRANT ALL ON public.cupons TO service_role;
CREATE POLICY cupons_empresa_ativa ON public.cupons FOR ALL TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()));
CREATE TRIGGER trg_cupons_upd BEFORE UPDATE ON public.cupons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS cupom text;

INSERT INTO public.cupons (empresa_id, codigo, valor, servico, canal)
SELECT '11111111-1111-1111-1111-111111111111', v.codigo, v.valor, v.servico, v.canal
  FROM (VALUES ('BLOG50', 50, 'higienizacao', 'BLOG'), ('SITE50', 50, 'higienizacao', 'SITE'),
               ('BLOG82', 82, 'impermeabilizacao', 'BLOG'), ('SITE82', 82, 'impermeabilizacao', 'SITE')
       ) v(codigo, valor, servico, canal)
 WHERE EXISTS (SELECT 1 FROM public.empresas WHERE id = '11111111-1111-1111-1111-111111111111')
ON CONFLICT (empresa_id, codigo) DO NOTHING;
