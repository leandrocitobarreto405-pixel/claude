-- Origem detectada (migração 20261201120000): ordem da detecção (clique, lead automático, primeira
-- mensagem, campanha, indicação, cliente antigo) e registro de quem troca a origem detectada.
-- Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'
CREATE FUNCTION pg_temp.cod(_codigo text) RETURNS uuid LANGUAGE sql AS $$
  SELECT private.origem_por_codigo('11111111-1111-1111-1111-111111111111', _codigo)
$$;
SELECT pg_temp.ok(pg_temp.cod('cliente_existente') IS NOT NULL AND pg_temp.cod('indicacao') IS NOT NULL
                  AND pg_temp.cod('instagram') IS NOT NULL, 'empresa de teste tem as origens com código');

-- 1. Clique da landing vale mesmo com outra origem escolhida à mão no lead.
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, sales_origin_id) VALUES
  ('a5800000-0000-0000-0000-000000000001', :'E', 'Lead Clique', '11975800001', '5511975800001', true, pg_temp.cod('instagram'));
INSERT INTO public.ads_clicks (empresa_id, crm_lead_id, telefone_raw, normalized_phone, gclid)
VALUES (:'E', 'a5800000-0000-0000-0000-000000000001', '11975800001', '5511975800001', 'gclid-ficticio-580');
SELECT pg_temp.ok((SELECT como = 'landing' AND origem_id = coalesce(pg_temp.cod('google_ads_landing'), pg_temp.cod('google'))
                     FROM private.origem_detectada_venda(:'E', 'a5800000-0000-0000-0000-000000000001', NULL)),
  'clique da landing');

-- 2. Origem automática do lead (canal Instagram).
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, sales_origin_id, origem_automatica) VALUES
  ('a5800000-0000-0000-0000-000000000002', :'E', 'Lead Insta', '11975800002', '5511975800002', true, pg_temp.cod('instagram'), true);
SELECT pg_temp.ok((SELECT como = 'canal' AND origem_id = pg_temp.cod('instagram')
                     FROM private.origem_detectada_venda(:'E', 'a5800000-0000-0000-0000-000000000002', NULL)),
  'origem automática do lead');
-- O mesmo lead achado só pelo telefone (OS criada direto).
SELECT pg_temp.ok((SELECT origem_id = pg_temp.cod('instagram')
                     FROM private.origem_detectada_venda(:'E', NULL, '(11) 97580-0002')),
  'lead achado pelo telefone');

-- 3. Indicação registrada, sem lead.
INSERT INTO public.mkt_contatos (id, empresa_id, nome, tipo, normalized_phone)
VALUES ('b5800000-0000-0000-0000-000000000001', :'E', 'Indicador Fictício', 'comprador', '5511975800009');
INSERT INTO public.indicacoes (empresa_id, indicador_contato_id, indicado_phone, indicado_nome)
VALUES (:'E', 'b5800000-0000-0000-0000-000000000001', '5511975800003', 'Indicada Fictícia');
SELECT pg_temp.ok((SELECT como = 'indicacao' AND origem_id = pg_temp.cod('indicacao')
                     FROM private.origem_detectada_venda(:'E', NULL, '11975800003')), 'indicação registrada');

-- 4. Cliente com OS anterior, sem lead.
INSERT INTO public.customers (id, empresa_id, full_name, phone)
VALUES ('c5800000-0000-0000-0000-000000000001', :'E', 'Cliente Antigo', '11975800004');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value)
VALUES ('e5800000-0000-0000-0000-000000000001', :'E', '58001', 'c5800000-0000-0000-0000-000000000001', 100);
SELECT pg_temp.ok((SELECT como = 'cliente_antigo' AND origem_id = pg_temp.cod('cliente_existente')
                     FROM private.origem_detectada_venda(:'E', NULL, '11975800004')), 'cliente antigo');

-- 5. Telefone desconhecido: nada detectado (campo vazio e obrigatório na tela).
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM private.origem_detectada_venda(:'E', NULL, '11975808888')),
  'telefone desconhecido');

-- 6. Troca: OS salva com outra origem grava a troca; voltar para a detectada limpa.
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sales_origin_id,
                                origem_detectada_id, origem_detectada_como)
VALUES ('e5800000-0000-0000-0000-000000000002', :'E', '58002', 'c5800000-0000-0000-0000-000000000001', 100,
        pg_temp.cod('google'), pg_temp.cod('instagram'), 'canal');
SELECT pg_temp.ok((SELECT origem_trocada_em IS NOT NULL FROM public.work_orders
                    WHERE id = 'e5800000-0000-0000-0000-000000000002'), 'troca registrada');
UPDATE public.work_orders SET sales_origin_id = pg_temp.cod('instagram') WHERE id = 'e5800000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((SELECT origem_trocada_em IS NULL FROM public.work_orders
                    WHERE id = 'e5800000-0000-0000-0000-000000000002'), 'voltou para a detectada');
-- Ninguém escreve a troca à mão.
UPDATE public.work_orders SET origem_trocada_em = now() WHERE id = 'e5800000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((SELECT origem_trocada_em IS NULL FROM public.work_orders
                    WHERE id = 'e5800000-0000-0000-0000-000000000002'), 'troca não se escreve à mão');

-- Orçamento: mesma regra.
INSERT INTO public.quotes (id, empresa_id, cliente_nome, sales_origin_id, origem_detectada_id, origem_detectada_como)
VALUES ('f5800000-0000-0000-0000-000000000001', :'E', 'Orçamento Fictício', pg_temp.cod('google'),
        pg_temp.cod('cliente_existente'), 'cliente_antigo');
SELECT pg_temp.ok((SELECT origem_trocada_em IS NOT NULL FROM public.quotes
                    WHERE id = 'f5800000-0000-0000-0000-000000000001'), 'troca no orçamento');

-- Origem detectada de outra empresa não vale.
INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Outra')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.config_options (id, empresa_id, kind, name)
VALUES ('d5800000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'sales_origin', 'Origem da outra');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sales_origin_id, origem_detectada_id)
VALUES ('e5800000-0000-0000-0000-000000000003', :'E', '58003', 'c5800000-0000-0000-0000-000000000001', 100,
        pg_temp.cod('google'), 'd5800000-0000-0000-0000-000000000001');
SELECT pg_temp.ok((SELECT origem_detectada_id IS NULL AND origem_trocada_em IS NULL FROM public.work_orders
                    WHERE id = 'e5800000-0000-0000-0000-000000000003'), 'detectada de outra empresa');
ROLLBACK;
