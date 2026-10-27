-- Conversões otimizadas para leads (migração 20261228160000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '84000000-0000-4000-8000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 840');
INSERT INTO public.config_options (id, empresa_id, kind, name, display_order) VALUES
  ('84000000-0000-4000-8000-0000000000f1', :'E', 'sales_origin', 'Google Ads – landing', 1),
  ('84000000-0000-4000-8000-0000000000f2', :'E', 'sales_origin', 'Google Ads – botão WhatsApp', 2),
  ('84000000-0000-4000-8000-0000000000f3', :'E', 'sales_origin', 'Google', 3),
  ('84000000-0000-4000-8000-0000000000f4', :'E', 'sales_origin', 'Cliente existente / Recorrência', 4);
INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id, exige_popup)
VALUES (:'E', 'Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.', '84000000-0000-4000-8000-0000000000f1', true);

-- Cada caso: cliente, lead (com origem) e OS ligada.
CREATE FUNCTION pg_temp.caso(_n int, _origem uuid, _status text DEFAULT 'Agendada') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.customers (id, empresa_id, full_name, phone, email)
  VALUES (('84000000-0000-4000-8000-0000000001' || lpad(_n::text, 2, '0'))::uuid, '84000000-0000-4000-8000-00000000000e',
          'Cliente Fictício ' || _n, '1198400' || lpad(_n::text, 4, '0'), 'cliente' || _n || '@exemplo.com');
  INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, status, total_gross_value, sales_origin_id)
  VALUES (('84000000-0000-4000-8000-0000000002' || lpad(_n::text, 2, '0'))::uuid, '84000000-0000-4000-8000-00000000000e',
          '84' || _n, ('84000000-0000-4000-8000-0000000001' || lpad(_n::text, 2, '0'))::uuid, _status, 300, _origem);
  INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, first_contact_date, sales_origin_id, linked_work_order_id, customer_id)
  VALUES (('84000000-0000-4000-8000-0000000003' || lpad(_n::text, 2, '0'))::uuid, '84000000-0000-4000-8000-00000000000e',
          'Lead Fictício ' || _n, '1198400' || lpad(_n::text, 4, '0'), '551198400' || lpad(_n::text, 4, '0'), current_date, _origem,
          ('84000000-0000-4000-8000-0000000002' || lpad(_n::text, 2, '0'))::uuid,
          ('84000000-0000-4000-8000-0000000001' || lpad(_n::text, 2, '0'))::uuid);
$$;
SELECT pg_temp.caso(1, '84000000-0000-4000-8000-0000000000f1');  -- clique com gclid
SELECT pg_temp.caso(2, '84000000-0000-4000-8000-0000000000f2');  -- botão do anúncio, sem clique
SELECT pg_temp.caso(3, '84000000-0000-4000-8000-0000000000f3');  -- "Google" com a frase da landing
SELECT pg_temp.caso(4, '84000000-0000-4000-8000-0000000000f3');  -- "Google" sem sinal de anúncio
SELECT pg_temp.caso(5, '84000000-0000-4000-8000-0000000000f4');  -- cliente da base
SELECT pg_temp.caso(6, '84000000-0000-4000-8000-0000000000f1', 'Cancelada');  -- cancelada
SELECT pg_temp.caso(7, '84000000-0000-4000-8000-0000000000f1');  -- clique só com gbraid (iPhone)
INSERT INTO public.ads_clicks (empresa_id, telefone_raw, gclid, servico, crm_lead_id, created_at)
VALUES (:'E', '11984000001', 'gclid-teste-840', 'higienizacao', '84000000-0000-4000-8000-000000000301', now() - interval '1 hour');
INSERT INTO public.ads_clicks (empresa_id, telefone_raw, gbraid, servico, crm_lead_id, created_at)
VALUES (:'E', '11984000007', 'gbraid-teste-840', 'impermeabilizacao', '84000000-0000-4000-8000-000000000307', now() - interval '1 hour');
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone) VALUES ('84000000-0000-4000-8000-000000000403', :'E', '5511984000003');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, crm_lead_id, direction, text_content)
VALUES (:'E', '84000000-0000-4000-8000-000000000403', '84000000-0000-4000-8000-000000000303', 'Recebida',
        'Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.');

CREATE TEMP TABLE c AS SELECT * FROM public.vw_conversoes_google_candidatas WHERE empresa_id = :'E';
SELECT pg_temp.ok((SELECT count(*) FROM c) = 4, 'entram 1 (gclid), 2 (botão), 3 (frase) e 7 (gbraid)');
SELECT pg_temp.ok((SELECT gclid FROM c WHERE work_order_id = '84000000-0000-4000-8000-000000000201') = 'gclid-teste-840', 'gclid da venda 1');
SELECT pg_temp.ok((SELECT base FROM c WHERE work_order_id = '84000000-0000-4000-8000-000000000202') = 'origem', 'botão: base origem');
SELECT pg_temp.ok((SELECT telefone IS NOT NULL AND email IS NOT NULL FROM c WHERE work_order_id = '84000000-0000-4000-8000-000000000203'), 'frase da landing: telefone e e-mail');
SELECT pg_temp.ok((SELECT gbraid = 'gbraid-teste-840' AND gclid IS NULL AND conversao_nome = 'Venda Impermeabilização' FROM c WHERE work_order_id = '84000000-0000-4000-8000-000000000207'), 'iPhone: gbraid e serviço');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM c WHERE work_order_id IN ('84000000-0000-4000-8000-000000000204', '84000000-0000-4000-8000-000000000205', '84000000-0000-4000-8000-000000000206')), '"Google" sem sinal, cliente da base e cancelada ficam fora');
SELECT pg_temp.ok((SELECT conversao_horario ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}-03:00$' FROM c LIMIT 1), 'horário com -03:00');

-- Guardada uma vez, não volta como candidata (nome e horário ficam os da primeira vez).
INSERT INTO public.ads_conversoes_google (empresa_id, work_order_id, gclid, conversao_nome, conversao_horario, valor, base, exportada_em)
SELECT empresa_id, work_order_id, gclid, conversao_nome, conversao_horario, valor, base, now() FROM c
 WHERE work_order_id = '84000000-0000-4000-8000-000000000201';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.vw_conversoes_google_candidatas WHERE work_order_id = '84000000-0000-4000-8000-000000000201'), 'não duplica');

-- Recompra: segunda OS do mesmo cliente que veio do botão do anúncio fica fora.
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, status, total_gross_value, sales_origin_id, created_at)
VALUES ('84000000-0000-4000-8000-000000000299', :'E', '8499', '84000000-0000-4000-8000-000000000102', 'Agendada', 200, '84000000-0000-4000-8000-0000000000f2', now() - interval '30 days');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.vw_conversoes_google_candidatas WHERE work_order_id = '84000000-0000-4000-8000-000000000202'), 'recompra sem clique fica fora');
ROLLBACK;
