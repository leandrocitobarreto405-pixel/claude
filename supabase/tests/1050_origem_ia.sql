-- Origem IA com prioridade (migração 20261228490000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set A '10500000-0000-4000-8000-00000000000a'
INSERT INTO public.empresas (id, nome) VALUES (:'A', 'Empresa Fictícia A 1050');
INSERT INTO public.config_options (id, empresa_id, kind, name, display_order, active, metadata) VALUES
  ('10500000-0000-4000-8000-0000000000b1', :'A', 'sales_origin', 'Site', 8, true, '{"codigo":"site","palavras":["cupom site*"]}'),
  ('10500000-0000-4000-8000-0000000000b2', :'A', 'sales_origin', 'Blog', 5, true, '{"codigo":"blog","palavras":["blog","cupom blog*"]}'),
  ('10500000-0000-4000-8000-0000000000b3', :'A', 'sales_origin', 'IA', 5, true, '{"codigo":"ia","prioridade":true,"palavras":["vim pelo chatgpt","vim pelo claude","chatgpt","chat gpt"]}'),
  ('10500000-0000-4000-8000-0000000000b4', :'A', 'sales_origin', 'Google Ads landing', 1, true, '{"codigo":"google_ads_landing","palavras":[]}'),
  ('10500000-0000-4000-8000-0000000000b5', :'A', 'sales_origin', 'Cliente existente', 6, true, '{"codigo":"cliente_existente","palavras":[]}');
INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id, servico, ativo) VALUES
  (:'A', 'Quero higienizar meu estofado com R$50 de desconto (cupom SITE50)', '10500000-0000-4000-8000-0000000000b1', 'higienizacao', true),
  (:'A', 'Vim pelo anúncio e quero um orçamento', '10500000-0000-4000-8000-0000000000b4', 'higienizacao', true);

CREATE FUNCTION pg_temp.origem(_t text, _cliente boolean DEFAULT false) RETURNS uuid LANGUAGE sql AS $$
  SELECT origem FROM private.identificar_origem_lead('10500000-0000-4000-8000-00000000000a', _t, NULL, _cliente, '{}'::jsonb)
$$;
CREATE FUNCTION pg_temp.servico(_t text) RETURNS text LANGUAGE sql AS $$
  SELECT servico FROM private.identificar_origem_lead('10500000-0000-4000-8000-00000000000a', _t, NULL, false, '{}'::jsonb)
$$;

SELECT pg_temp.ok(pg_temp.origem('Olá! Vim pelo blog e quero um orçamento. (vim pelo ChatGPT)') = '10500000-0000-4000-8000-0000000000b3', 'blog + ChatGPT → IA');
SELECT pg_temp.ok(pg_temp.origem('Olá! Quero higienizar meu estofado com R$50 de desconto (cupom SITE50). (vim pelo ChatGPT)') = '10500000-0000-4000-8000-0000000000b3', 'mensagem cadastrada do site + ChatGPT → IA');
SELECT pg_temp.ok(pg_temp.servico('Olá! Quero higienizar meu estofado com R$50 de desconto (cupom SITE50). (vim pelo ChatGPT)') = 'higienizacao', 'serviço da mensagem cadastrada continua');
SELECT pg_temp.ok(pg_temp.origem('Olá! Quero higienizar meu estofado com R$50 de desconto (cupom SITE50).') = '10500000-0000-4000-8000-0000000000b1', 'sem IA: site como antes');
SELECT pg_temp.ok(pg_temp.origem('Olá! Quero um orçamento.') IS NULL, 'mensagem comum: sem origem, como antes');
SELECT pg_temp.ok(pg_temp.origem('Olá! Vim pelo blog e quero um orçamento.') = '10500000-0000-4000-8000-0000000000b2', 'só blog: blog como antes');
SELECT pg_temp.ok(pg_temp.origem('Vim pelo anúncio e quero um orçamento (vim pelo ChatGPT)') = '10500000-0000-4000-8000-0000000000b4', 'mensagem de Google Ads continua vencendo a IA');
SELECT pg_temp.ok(pg_temp.origem('Oi (vim pelo ChatGPT)', true) = '10500000-0000-4000-8000-0000000000b5', 'cliente existente continua cliente existente');
SELECT pg_temp.ok(pg_temp.origem('Oi, meu nome é Claude e quero um orçamento') IS NULL, 'nome Claude sozinho não vira IA');
ROLLBACK;
