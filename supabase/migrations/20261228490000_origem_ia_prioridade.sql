-- Origem "IA (ChatGPT e outras)" na Turbine e palavras com prioridade — 10/11, plano aprovado pelo
-- dono. Desde 26/10 o site da Turbine acrescenta "(vim pelo ChatGPT)" (ou Perplexity, Gemini,
-- Copilot, Claude) à mensagem do WhatsApp. Antes, a mensagem cadastrada (frase do site/blog com
-- cupom) vencia as palavras-chave e esses leads ficavam como "Site (orgânico)" ou "Blog".
--
-- Ordem nova da identificação:
--   1. cliente existente, Instagram, Facebook (como antes);
--   2. palavras de origem marcadas com "prioridade" (metadata.prioridade = true), exceto quando a
--      mensagem cadastrada é de campanha ou de origem Google Ads (essas continuam vencendo);
--   3. mensagem cadastrada (campanha e serviço continuam vindo dela em qualquer caso);
--   4. palavras-chave comuns.
-- Gclid e landing page do Google são tratados em outro ponto e continuam com prioridade.

-- ---------------------------------------------------------------- 1) origem IA (Turbine)
INSERT INTO public.config_options (empresa_id, kind, name, display_order, active, metadata)
SELECT '11111111-1111-1111-1111-111111111111', 'sales_origin', 'IA (ChatGPT e outras)', 5, true,
       jsonb_build_object('codigo', 'ia', 'prioridade', true, 'palavras', jsonb_build_array(
         'vim pelo chatgpt', 'vim pelo perplexity', 'vim pelo gemini', 'vim pelo copilot',
         'vim pelo claude', 'chatgpt', 'chat gpt'))
 WHERE EXISTS (SELECT 1 FROM public.empresas WHERE id = '11111111-1111-1111-1111-111111111111')
   AND NOT EXISTS (SELECT 1 FROM public.config_options
                    WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
                      AND kind = 'sales_origin' AND metadata->>'codigo' = 'ia');

-- ---------------------------------------------------------------- 2) identificação
CREATE OR REPLACE FUNCTION private.identificar_origem_lead(
  _empresa_id uuid, _texto text, _canal text, _eh_cliente boolean, _atributos jsonb
) RETURNS TABLE (origem uuid, campanha uuid, servico text)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  codigo text;
  txt text := private.texto_busca(_texto);
  anuncio text := lower(coalesce(_atributos::text, ''));
  msg_origem uuid;
  prio_origem uuid;
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

  -- Palavras com prioridade (ex.: "vim pelo ChatGPT"): vencem a mensagem cadastrada do site/blog,
  -- mas não a de campanha nem a de origem Google Ads.
  IF origem IS NULL AND length(trim(txt)) > 0 AND campanha IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.config_options g
                      WHERE g.id = msg_origem AND g.metadata->>'codigo' LIKE 'google_ads%') THEN
    FOR r IN
      SELECT o.id, o.metadata->'palavras' AS palavras FROM public.config_options o
       WHERE o.empresa_id = _empresa_id AND o.kind = 'sales_origin' AND o.active
         AND coalesce((o.metadata->>'prioridade')::boolean, false)
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
        prio_origem := r.id;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  origem := coalesce(origem, prio_origem, msg_origem);

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
