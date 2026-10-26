-- Valor líquido (sem o repasse a parceiros) nos indicadores do funil; a comissão da OS fica no
-- valor cheio (o que o app grava), com ou sem terceirizado. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'

INSERT INTO public.technicians (id, empresa_id, name, parceiro)
VALUES ('d4400000-0000-0000-0000-000000000001', :'E', 'Parceiro Fictício 440', true);
INSERT INTO public.tabela_precos_itens (id, empresa_id, nome, preco_higienizacao, categoria, terceirizado,
  custo_parceiro, parceiro_id)
VALUES ('b4400000-0000-0000-0000-000000000001', :'E', 'Tapete fictício 440 (por m²)', 60, 'tapete', true, 30,
        'd4400000-0000-0000-0000-000000000001');

-- Período isolado (junho de 2031): uma OS com tapete terceirizado (600, repasse 120) e uma sem (300).
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c4400000-0000-0000-0000-000000000001', :'E', 'Cliente Fictício A', '11944000001'),
  ('c4400000-0000-0000-0000-000000000002', :'E', 'Cliente Fictício B', '11944000002');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date,
  commission_percentage_snapshot, commission_expected) VALUES
  ('e4400000-0000-0000-0000-000000000001', :'E', '44001', 'c4400000-0000-0000-0000-000000000001', 600, '2031-06-10', 10, 60),
  ('e4400000-0000-0000-0000-000000000002', :'E', '44002', 'c4400000-0000-0000-0000-000000000002', 300, '2031-06-11', 10, 30);
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status, visit_value) VALUES
  ('f4400000-0000-0000-0000-000000000001', :'E', 'e4400000-0000-0000-0000-000000000001', '2031-06-12', '09:00', 'Agendado', 600),
  ('f4400000-0000-0000-0000-000000000002', :'E', 'e4400000-0000-0000-0000-000000000002', '2031-06-12', '14:00', 'Agendado', 300);
INSERT INTO public.service_items (empresa_id, visit_id, description, quantity, unit_price, subtotal, unidade) VALUES
  (:'E', 'f4400000-0000-0000-0000-000000000001', 'Tapete fictício 440 (por m²) — Limpeza', 4, 60, 240, 'm2'),
  (:'E', 'f4400000-0000-0000-0000-000000000001', 'Sofá fictício 440 — Higienização', 1, 360, 360, 'un'),
  (:'E', 'f4400000-0000-0000-0000-000000000002', 'Sofá fictício 440 — Higienização', 1, 300, 300, 'un');

-- 1) comissão sobre o valor cheio (regra de 26/10): a OS com terceirizado fica com os 60 do app
SELECT pg_temp.ok((SELECT commission_expected FROM public.work_orders WHERE os_number = '44001') = 60,
  'prevista cheia com item terceirizado');
SELECT pg_temp.ok((SELECT commission_expected FROM public.work_orders WHERE os_number = '44002') = 30,
  'OS sem terceirizado não muda');
UPDATE public.work_orders SET commission_expected = 31 WHERE os_number = '44002';
SELECT pg_temp.ok((SELECT commission_expected FROM public.work_orders WHERE os_number = '44002') = 31,
  'sem terceirizado vale o que o app gravou');

-- 2) concluir (repasse vira despesa) não mexe na comissão realizada gravada pelo app
UPDATE public.visits SET status = 'Concluído', completion_date = '2031-06-12'
 WHERE id = 'f4400000-0000-0000-0000-000000000001';
UPDATE public.work_orders SET commission_realized = 60 WHERE os_number = '44001';
SELECT pg_temp.ok((SELECT commission_expected || '/' || commission_realized FROM public.work_orders
                    WHERE os_number = '44001') = '60.00/60.00', 'realizada cheia');
SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.visits WHERE id = 'f4400000-0000-0000-0000-000000000001') = 120,
  'repasse de 120 no atendimento');

-- 3) indicadores do funil: vendido e ticket pelo líquido (480 + 300)
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, first_contact_date) VALUES
  ('a4400000-0000-0000-0000-000000000001', :'E', 'Lead Fictício A', '11944000001', '5511944000001', true, '2031-06-02'),
  ('a4400000-0000-0000-0000-000000000002', :'E', 'Lead Fictício B', '11944000002', '5511944000002', true, '2031-06-03');
SELECT private.converter_lead_em_os('a4400000-0000-0000-0000-000000000001', 'e4400000-0000-0000-0000-000000000001');
SELECT private.converter_lead_em_os('a4400000-0000-0000-0000-000000000002', 'e4400000-0000-0000-0000-000000000002');
SELECT set_config('teste.ind', public.indicadores_funil('2031-06-01', '2031-06-30')::text, false);
SELECT pg_temp.ok((current_setting('teste.ind')::jsonb->'valores'->>'vendido')::numeric = 780,
  'vendido dos leads sem o repasse (' || (current_setting('teste.ind')::jsonb->'valores'->>'vendido') || ')');
SELECT pg_temp.ok((current_setting('teste.ind')::jsonb->'periodo_geral'->>'vendido')::numeric = 780,
  'vendido do período sem o repasse');
SELECT pg_temp.ok((current_setting('teste.ind')::jsonb->'periodo_geral'->>'ticket_medio')::numeric = 390,
  'ticket médio pelo líquido');
SELECT pg_temp.ok((SELECT sum((o->>'vendido')::numeric) FROM jsonb_array_elements(current_setting('teste.ind')::jsonb->'origens') o) = 780,
  'vendido por origem pelo líquido');

ROLLBACK;
