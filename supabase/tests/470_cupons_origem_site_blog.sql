-- Origem Site x Blog pelas mensagens prontas e pela reserva ("blog", "cupom site"), cupons
-- por empresa e a troca dos leads da landing para "Google Ads – landing". Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'
CREATE FUNCTION pg_temp.og(_codigo text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.config_options WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
     AND kind = 'sales_origin' AND metadata->>'codigo' = _codigo ORDER BY display_order LIMIT 1
$$;
CREATE FUNCTION pg_temp.ident(_txt text) RETURNS TABLE (origem uuid, servico text) LANGUAGE sql AS $$
  SELECT i.origem, i.servico
    FROM private.identificar_origem_lead('11111111-1111-1111-1111-111111111111', _txt, NULL, false, '{}') i
$$;

-- 1) textos do site e do blog
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('Olá! Quero higienizar meu estofado com R$50 de desconto (cupom SITE50).')) = pg_temp.og('site'),
  'cupom SITE50 → Site');
SELECT pg_temp.ok((SELECT servico FROM pg_temp.ident('ola quero um orcamento de limpeza de tapete')) = 'Tapete',
  'tapete ganha o serviço (texto mais longo vence o genérico)');
-- O botão geral (já cadastrado em produção) continua Site e perde para os textos mais longos.
INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id)
SELECT :'E', 'Olá! Quero um orçamento.', pg_temp.og('site')
 WHERE NOT EXISTS (SELECT 1 FROM public.mensagens_origem WHERE empresa_id = :'E'
                    AND private.texto_busca(texto) = private.texto_busca('Olá! Quero um orçamento.'));
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('Olá! Quero um orçamento.')) = pg_temp.og('site'),
  'botão geral continua Site');
SELECT pg_temp.ok((SELECT servico FROM pg_temp.ident('Olá! Quero um orçamento de limpeza de persianas.')) = 'Persiana',
  'persianas vence o genérico');
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('Olá! Vi o post sobre colchão sujo no blog e quero um orçamento.')) = pg_temp.og('blog'),
  'post do blog → Blog');
SELECT pg_temp.ok((SELECT servico FROM pg_temp.ident('Olá! Vi o post sobre limpeza de persianas no blog e quero um orçamento.')) = 'Persiana',
  'post de persianas → serviço Persiana');

-- 2) reserva: post novo do blog e cupom do site sem texto cadastrado
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('Oi! Li o artigo novo do blog sobre poltronas')) = pg_temp.og('blog'),
  'texto novo com "do blog" → Blog');
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('Quero usar o cupom SITE30')) = pg_temp.og('site'),
  'texto novo com "cupom SITE" → Site');
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('tenho o cupom BLOG50')) = pg_temp.og('blog'),
  '"cupom BLOG50" sem a palavra blog → Blog');
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('Bom dia, quanto custa?')) IS NULL, 'texto sem pista fica sem origem');
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('vi um site de vocês')) IS NULL, '"site" sozinho não dá origem');
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('vim pelo google')) = pg_temp.og('google'), 'palavra inteira continua igual');

-- 3) landing não é trocada pela reserva: o texto da LP tem prioridade sobre as palavras
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.'))
                  IS DISTINCT FROM pg_temp.og('blog'), 'texto da landing não vira Blog');

-- 4) cupons: os 4 da Turbine, códigos únicos por empresa
SELECT pg_temp.ok((SELECT count(*) FROM public.cupons WHERE empresa_id = :'E' AND ativo) = 4, 'quatro cupons');
SELECT pg_temp.ok((SELECT valor FROM public.cupons WHERE empresa_id = :'E' AND codigo = 'BLOG82') = 82
                  AND (SELECT servico FROM public.cupons WHERE empresa_id = :'E' AND codigo = 'BLOG82') = 'impermeabilizacao',
  'BLOG82 = R$ 82 na impermeabilização');
DO $$ BEGIN
  INSERT INTO public.cupons (empresa_id, codigo, valor, servico) VALUES ('11111111-1111-1111-1111-111111111111', 'BLOG50', 10, 'higienizacao');
  RAISE EXCEPTION 'FALHOU: cupom repetido entrou';
EXCEPTION WHEN unique_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.cupons (empresa_id, codigo, valor, servico) VALUES ('11111111-1111-1111-1111-111111111111', 'blog 10', 10, 'higienizacao');
  RAISE EXCEPTION 'FALHOU: código fora do padrão entrou';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- 5) troca dos leads da landing (outubro)
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, origem) VALUES
  ('c4700000-0000-0000-0000-000000000001', :'E', '5511947000001', 'chatwoot'),
  ('c4700000-0000-0000-0000-000000000002', :'E', '5511947000002', 'chatwoot'),
  ('c4700000-0000-0000-0000-000000000003', :'E', '5511947000003', 'chatwoot'),
  ('c4700000-0000-0000-0000-000000000004', :'E', '5511947000004', 'chatwoot');
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, sales_origin_id, origem_automatica,
  gclid, created_at, whatsapp_contact_id) VALUES
  ('a4700000-0000-0000-0000-000000000001', :'E', 'Pop-up', '11947000001', '5511947000001', pg_temp.og('google'), true, 'gclid-x', '2026-10-10 10:00-03', 'c4700000-0000-0000-0000-000000000001'),
  ('a4700000-0000-0000-0000-000000000002', :'E', 'Texto da LP', '11947000002', '5511947000002', pg_temp.og('google'), true, NULL, '2026-10-11 10:00-03', 'c4700000-0000-0000-0000-000000000002'),
  ('a4700000-0000-0000-0000-000000000003', :'E', 'Manual', '11947000003', '5511947000003', pg_temp.og('google'), false, 'gclid-y', '2026-10-12 10:00-03', 'c4700000-0000-0000-0000-000000000003'),
  ('a4700000-0000-0000-0000-000000000004', :'E', 'Outra conversa', '11947000004', '5511947000004', pg_temp.og('google'), true, NULL, '2026-10-13 10:00-03', 'c4700000-0000-0000-0000-000000000004');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, crm_lead_id, direction, text_content, message_timestamp) VALUES
  (:'E', 'c4700000-0000-0000-0000-000000000002', 'a4700000-0000-0000-0000-000000000002', 'Recebida', 'Olá, gostaria de um orçamento para higienização do meu colchão, por favor.', '2026-10-11 10:00-03'),
  (:'E', 'c4700000-0000-0000-0000-000000000004', 'a4700000-0000-0000-0000-000000000004', 'Recebida', 'Bom dia', '2026-10-13 10:00-03');

-- Texto da LP cadastrado como "Google" (como em produção antes da troca).
INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id, servico)
SELECT :'E', 'Olá, gostaria de um orçamento para higienização do meu colchão, por favor.', pg_temp.og('google'), 'Higienização'
 WHERE NOT EXISTS (SELECT 1 FROM public.mensagens_origem WHERE empresa_id = :'E'
   AND private.texto_busca(texto) = private.texto_busca('Olá, gostaria de um orçamento para higienização do meu colchão, por favor.'));

\ir ../../scripts/origens/google-ads-landing-outubro.sql
CREATE FUNCTION pg_temp.cod(_lead uuid) RETURNS text LANGUAGE sql AS $$
  SELECT o.metadata->>'codigo' FROM public.crm_leads l JOIN public.config_options o ON o.id = l.sales_origin_id WHERE l.id = _lead
$$;
SELECT pg_temp.ok(pg_temp.cod('a4700000-0000-0000-0000-000000000001') = 'google_ads_landing', 'pop-up → landing');
SELECT pg_temp.ok(pg_temp.cod('a4700000-0000-0000-0000-000000000002') = 'google_ads_landing', 'texto da LP sem gclid → landing');
SELECT pg_temp.ok(pg_temp.cod('a4700000-0000-0000-0000-000000000003') = 'google', 'origem escolhida à mão não muda');
SELECT pg_temp.ok(pg_temp.cod('a4700000-0000-0000-0000-000000000004') = 'google', 'sem gclid nem texto da LP não muda');
SELECT pg_temp.ok((SELECT origem FROM pg_temp.ident('Olá, gostaria de um orçamento para higienização do meu colchão, por favor.'))
                  = pg_temp.og('google_ads_landing'), 'texto da LP passa a dar landing');

ROLLBACK;
