-- Origem "Google Ads – botão WhatsApp" pela primeira mensagem do anúncio (mensagem pronta) e
-- "Google Ads – landing" pelo clique do pop-up; retroativo só troca origem vazia ou automática.
-- Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'
CREATE FUNCTION pg_temp.origem(_lead uuid) RETURNS text LANGUAGE sql AS $$
  SELECT o.name FROM public.crm_leads l JOIN public.config_options o ON o.id = l.sales_origin_id WHERE l.id = _lead
$$;
CREATE FUNCTION pg_temp.og(_nome text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.config_options WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
     AND kind = 'sales_origin' AND name = _nome
$$;

-- 1) as duas origens e a mensagem pronta existem
SELECT pg_temp.ok(pg_temp.og('Google Ads – botão WhatsApp') IS NOT NULL AND pg_temp.og('Google Ads – landing') IS NOT NULL,
  'origens criadas');
SELECT pg_temp.ok((SELECT servico FROM public.mensagens_origem WHERE sales_origin_id = pg_temp.og('Google Ads – botão WhatsApp')) = 'Higienização',
  'mensagem pronta do anúncio com serviço');

-- 2) lead novo: identificação pela primeira mensagem (sem acento, maiúscula nem pontuação)
SELECT pg_temp.ok((SELECT origem FROM private.identificar_origem_lead(:'E', 'OLA vim do Google, e gostaria de mais informacoes', NULL, false, '{}'))
                  = pg_temp.og('Google Ads – botão WhatsApp'), 'texto do anúncio dá a origem do botão');
SELECT pg_temp.ok((SELECT servico FROM private.identificar_origem_lead(:'E', 'Olá, vim do google e gostaria de mais informações!', NULL, false, '{}'))
                  = 'Higienização', 'serviço higienização');
SELECT pg_temp.ok((SELECT origem FROM private.identificar_origem_lead(:'E', 'oi, vim pelo google', NULL, false, '{}'))
                  = pg_temp.og('Google'), 'outra frase com google continua "Google" (palavra-chave)');

-- 3) pop-up: lead com gclid e sem origem → landing
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, gclid)
VALUES ('a4600000-0000-0000-0000-000000000009', :'E', 'Pop-up', '11946000009', '5511946000009', 'gclid-teste');
SELECT pg_temp.ok(pg_temp.origem('a4600000-0000-0000-0000-000000000009') = 'Google Ads – landing', 'gclid → Google Ads – landing');

-- 4) retroativo
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, origem) VALUES
  ('c4600000-0000-0000-0000-000000000001', :'E', '5511946000001', 'chatwoot'),
  ('c4600000-0000-0000-0000-000000000002', :'E', '5511946000002', 'chatwoot'),
  ('c4600000-0000-0000-0000-000000000003', :'E', '5511946000003', 'chatwoot'),
  ('c4600000-0000-0000-0000-000000000004', :'E', '5511946000004', 'chatwoot');
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c4600000-0000-0000-0000-0000000000c1', :'E', 'Cliente Botão', '11946000001');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sales_origin_id) VALUES
  ('e4600000-0000-0000-0000-000000000001', :'E', '46001', 'c4600000-0000-0000-0000-0000000000c1', 300, pg_temp.og('Google'));
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, sales_origin_id, origem_automatica,
  service_interest, created_at, whatsapp_contact_id) VALUES
  -- automático "Google", primeira mensagem = anúncio, com OS
  ('a4600000-0000-0000-0000-000000000001', :'E', 'Botão com OS', '11946000001', '5511946000001', pg_temp.og('Google'), true, NULL, '2026-10-06 10:00-03', 'c4600000-0000-0000-0000-000000000001'),
  -- origem escolhida à mão: não muda
  ('a4600000-0000-0000-0000-000000000002', :'E', 'Botão manual', '11946000002', '5511946000002', pg_temp.og('Instagram'), false, NULL, '2026-10-07 10:00-03', 'c4600000-0000-0000-0000-000000000002'),
  -- anúncio só na segunda mensagem: não muda
  ('a4600000-0000-0000-0000-000000000003', :'E', 'Segunda mensagem', '11946000003', '5511946000003', NULL, false, NULL, '2026-10-08 10:00-03', 'c4600000-0000-0000-0000-000000000003'),
  -- antes de 01/10: não muda
  ('a4600000-0000-0000-0000-000000000004', :'E', 'Antigo', '11946000004', '5511946000004', pg_temp.og('Google'), true, 'Impermeabilização', '2026-09-20 10:00-03', 'c4600000-0000-0000-0000-000000000004');
SELECT private.converter_lead_em_os('a4600000-0000-0000-0000-000000000001', 'e4600000-0000-0000-0000-000000000001');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, crm_lead_id, direction, text_content, message_timestamp) VALUES
  (:'E', 'c4600000-0000-0000-0000-000000000001', 'a4600000-0000-0000-0000-000000000001', 'Recebida', 'Olá, vim do google e gostaria de mais informações!', '2026-10-06 10:00-03'),
  (:'E', 'c4600000-0000-0000-0000-000000000002', 'a4600000-0000-0000-0000-000000000002', 'Recebida', 'olá vim do google e gostaria de mais informações', '2026-10-07 10:00-03'),
  (:'E', 'c4600000-0000-0000-0000-000000000003', 'a4600000-0000-0000-0000-000000000003', 'Recebida', 'Bom dia', '2026-10-08 10:00-03'),
  (:'E', 'c4600000-0000-0000-0000-000000000003', 'a4600000-0000-0000-0000-000000000003', 'Recebida', 'Olá, vim do google e gostaria de mais informações!', '2026-10-08 10:01-03'),
  (:'E', 'c4600000-0000-0000-0000-000000000004', 'a4600000-0000-0000-0000-000000000004', 'Recebida', 'Olá, vim do google e gostaria de mais informações!', '2026-09-20 10:00-03');
-- Pop-up antigo sem origem (o gatilho só roda com gclid no lead; aqui só há o clique).
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, created_at)
VALUES ('a4600000-0000-0000-0000-000000000005', :'E', 'Pop-up sem origem', '11946000005', '5511946000005', '2026-10-09 10:00-03');
INSERT INTO public.ads_clicks (empresa_id, crm_lead_id, gclid, telefone_raw)
VALUES (:'E', 'a4600000-0000-0000-0000-000000000005', 'gclid-velho', '11946000005');
UPDATE public.crm_leads SET sales_origin_id = NULL WHERE id = 'a4600000-0000-0000-0000-000000000005';

\ir ../../scripts/origens/google-ads-retroativo.sql
SELECT pg_temp.ok(pg_temp.origem('a4600000-0000-0000-0000-000000000001') = 'Google Ads – botão WhatsApp', 'automático → botão');
SELECT pg_temp.ok((SELECT service_interest FROM public.crm_leads WHERE id = 'a4600000-0000-0000-0000-000000000001') = 'Higienização',
  'serviço preenchido');
SELECT pg_temp.ok((SELECT o.name FROM public.work_orders w JOIN public.config_options o ON o.id = w.sales_origin_id
                    WHERE w.id = 'e4600000-0000-0000-0000-000000000001') = 'Google Ads – botão WhatsApp', 'OS acompanha');
SELECT pg_temp.ok(pg_temp.origem('a4600000-0000-0000-0000-000000000002') = 'Instagram', 'origem manual não muda');
SELECT pg_temp.ok(pg_temp.origem('a4600000-0000-0000-0000-000000000003') IS NULL, 'só a primeira mensagem conta');
SELECT pg_temp.ok(pg_temp.origem('a4600000-0000-0000-0000-000000000004') = 'Google', 'antes de 01/10 não muda');
SELECT pg_temp.ok(pg_temp.origem('a4600000-0000-0000-0000-000000000005') = 'Google Ads – landing', 'pop-up sem origem → landing');
SELECT pg_temp.ok((SELECT botao_leads = 1 AND botao_com_os = 1 AND os = '46001' AND landing_leads = 1 FROM _resultado_origem),
  'contagem do retroativo');

ROLLBACK;
