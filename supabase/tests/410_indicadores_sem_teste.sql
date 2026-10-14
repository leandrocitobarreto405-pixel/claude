-- Indicadores sem OS de teste: conversão, vendas por origem, OS e recebimentos do período ignoram
-- OS marcadas como teste; a ligação automática pula OS de teste. Dados fictícios.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'

CREATE FUNCTION pg_temp.origem(_nome text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.config_options WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
     AND kind = 'sales_origin' AND name = _nome
$$;

-- ---------------------------------------------------------------- 1) indicadores do funil
-- Dois leads que chamaram em maio de 2031 (período isolado): um virou OS de verdade, outro virou OS de teste.
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c4100000-0000-0000-0000-000000000001', :'E', 'Cliente Real', '11971100001'),
  ('c4100000-0000-0000-0000-000000000002', :'E', 'Cliente Teste', '11971100002');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sales_origin_id, sale_date, eh_teste) VALUES
  ('e4100000-0000-0000-0000-000000000001', :'E', '41001', 'c4100000-0000-0000-0000-000000000001', 300, pg_temp.origem('Google'), '2031-05-10', false),
  ('e4100000-0000-0000-0000-000000000002', :'E', '41002', 'c4100000-0000-0000-0000-000000000002', 900, pg_temp.origem('Google'), '2031-05-11', true);
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, sales_origin_id, first_contact_date) VALUES
  ('a4100000-0000-0000-0000-000000000001', :'E', 'Lead real', '11971100001', '5511971100001', true, pg_temp.origem('Google'), '2031-05-02'),
  ('a4100000-0000-0000-0000-000000000002', :'E', 'Lead de teste', '11971100002', '5511971100002', true, pg_temp.origem('Google'), '2031-05-03');
SELECT private.converter_lead_em_os('a4100000-0000-0000-0000-000000000001', 'e4100000-0000-0000-0000-000000000001');
SELECT private.converter_lead_em_os('a4100000-0000-0000-0000-000000000002', 'e4100000-0000-0000-0000-000000000002');
INSERT INTO public.payments (empresa_id, work_order_id, payment_date, gross_amount, net_amount, payment_status, is_active, payment_channel, payment_type)
VALUES (:'E', 'e4100000-0000-0000-0000-000000000001', '2031-05-12', 300, 300, 'Pago', true, 'Pix direto', 'Pix'),
       (:'E', 'e4100000-0000-0000-0000-000000000002', '2031-05-12', 900, 900, 'Pago', true, 'Pix direto', 'Pix');

SELECT set_config('teste.ind', public.indicadores_funil('2031-05-01', '2031-05-31')::text, false);
SELECT pg_temp.ok((current_setting('teste.ind')::jsonb->'funil'->>'leads')::int = 2, 'os dois leads contam como leads');
SELECT pg_temp.ok((current_setting('teste.ind')::jsonb->'funil'->>'os_criada')::int = 1, 'só a OS de verdade conta na conversão');
SELECT pg_temp.ok((current_setting('teste.ind')::jsonb->'valores'->>'vendido')::numeric = 300, 'vendido dos leads ignora a OS de teste');
SELECT pg_temp.ok((current_setting('teste.ind')::jsonb->'valores'->>'recebido')::numeric = 300, 'recebido dos leads ignora a OS de teste');
SELECT pg_temp.ok((current_setting('teste.ind')::jsonb->'periodo_geral'->>'os')::int = 1
                  AND (current_setting('teste.ind')::jsonb->'periodo_geral'->>'vendido')::numeric = 300
                  AND (current_setting('teste.ind')::jsonb->'periodo_geral'->>'recebido')::numeric = 300,
                  'OS, vendido e recebido do período ignoram a OS de teste');
SELECT pg_temp.ok((SELECT (o->>'vendas')::int = 1 AND (o->>'vendido')::numeric = 300 AND (o->>'leads')::int = 2
                     FROM jsonb_array_elements(current_setting('teste.ind')::jsonb->'origens') o
                    WHERE o->>'origem' = 'Google'),
                  'vendas por origem: 2 leads do Google, 1 venda de verdade');

-- ---------------------------------------------------------------- 2) ligação automática pula OS de teste
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c4100000-0000-0000-0000-000000000003', :'E', 'Cliente Auto', '11971100003'),
  ('c4100000-0000-0000-0000-000000000004', :'E', 'Cliente Auto Teste', '11971100004');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, created_at, eh_teste) VALUES
  ('e4100000-0000-0000-0000-000000000003', :'E', '41003', 'c4100000-0000-0000-0000-000000000003', 100, now() - interval '20 minutes', false),
  ('e4100000-0000-0000-0000-000000000004', :'E', '41004', 'c4100000-0000-0000-0000-000000000004', 100, now() - interval '20 minutes', true);
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open) VALUES
  ('a4100000-0000-0000-0000-000000000003', :'E', 'Lead auto', '11971100003', '5511971100003', true),
  ('a4100000-0000-0000-0000-000000000004', :'E', 'Lead auto teste', '11971100004', '5511971100004', true);
SELECT set_config('teste.lig', public.crm_ligar_os_sem_lead(:'E')::text, false);
SELECT pg_temp.ok((SELECT linked_work_order_id = 'e4100000-0000-0000-0000-000000000003' AND NOT is_open
                     FROM public.crm_leads WHERE id = 'a4100000-0000-0000-0000-000000000003'),
                  'OS de verdade é ligada ao lead pelo telefone');
SELECT pg_temp.ok((SELECT linked_work_order_id IS NULL AND is_open
                     FROM public.crm_leads WHERE id = 'a4100000-0000-0000-0000-000000000004'),
                  'OS de teste não é ligada e não fecha o lead');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ads_eventos WHERE tipo = 'vinculo'
                                AND detalhe->>'work_order_id' = 'e4100000-0000-0000-0000-000000000004'),
                  'OS de teste não gera evento de vínculo');

ROLLBACK;
