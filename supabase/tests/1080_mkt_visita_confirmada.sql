-- Visita confirmada conta como visita marcada no marketing (migração 20261228520000; arquivo 1080).
-- Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'

-- Três pessoas com OS antiga (venda há 100 dias) e visita daqui a 3 dias: Confirmado, Em
-- deslocamento e Cancelado.
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c1080000-0000-0000-0000-000000000001', :'E', 'Confirmada Fictícia', '11910800001'),
  ('c1080000-0000-0000-0000-000000000002', :'E', 'Caminho Fictícia', '11910800002'),
  ('c1080000-0000-0000-0000-000000000003', :'E', 'Cancelada Fictícia', '11910800003');
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, first_contact_date, created_at, last_interaction_at) VALUES
  ('a1080000-0000-0000-0000-000000000001', :'E', 'Confirmada Fictícia', '11910800001', '5511910800001', true, current_date - 120, now() - interval '120 days', now() - interval '120 days'),
  ('a1080000-0000-0000-0000-000000000002', :'E', 'Caminho Fictícia', '11910800002', '5511910800002', true, current_date - 120, now() - interval '120 days', now() - interval '120 days'),
  ('a1080000-0000-0000-0000-000000000003', :'E', 'Cancelada Fictícia', '11910800003', '5511910800003', true, current_date - 120, now() - interval '120 days', now() - interval '120 days');
UPDATE public.mkt_contatos c
   SET nome = l.lead_name, primeiro_nome = split_part(l.lead_name, ' ', 1), crm_lead_id = l.id
  FROM public.crm_leads l
 WHERE l.id::text LIKE 'a1080000-%' AND c.empresa_id = l.empresa_id
   AND private.telefone_chave(c.normalized_phone) = private.telefone_chave(l.normalized_phone);
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date) VALUES
  ('e1080000-0000-0000-0000-000000000001', :'E', '108001', 'c1080000-0000-0000-0000-000000000001', 300, current_date - 100),
  ('e1080000-0000-0000-0000-000000000002', :'E', '108002', 'c1080000-0000-0000-0000-000000000002', 300, current_date - 100),
  ('e1080000-0000-0000-0000-000000000003', :'E', '108003', 'c1080000-0000-0000-0000-000000000003', 300, current_date - 100);
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status) VALUES
  ('f1080000-0000-0000-0000-000000000001', :'E', 'e1080000-0000-0000-0000-000000000001', current_date + 3, '09:00', 'Confirmado'),
  ('f1080000-0000-0000-0000-000000000002', :'E', 'e1080000-0000-0000-0000-000000000002', current_date + 3, '14:00', 'Em deslocamento'),
  ('f1080000-0000-0000-0000-000000000003', :'E', 'e1080000-0000-0000-0000-000000000003', current_date + 3, '09:00', 'Cancelado');

-- Visita marcada do contato (a promoção da agenda não chama quem tem).
SELECT pg_temp.ok((SELECT agendado_para = current_date + 3 FROM private.mkt_listas_dados(:'E', NULL) WHERE nome = 'Confirmada Fictícia'),
  'visita Confirmado conta como visita marcada');
SELECT pg_temp.ok((SELECT agendado_para = current_date + 3 FROM private.mkt_listas_dados(:'E', NULL) WHERE nome = 'Caminho Fictícia'),
  'visita Em deslocamento conta como visita marcada');
SELECT pg_temp.ok((SELECT agendado_para IS NULL FROM private.mkt_listas_dados(:'E', NULL) WHERE nome = 'Cancelada Fictícia'),
  'visita cancelada não conta');

-- "Tem OS": OS antiga com visita ainda em aberto.
SELECT pg_temp.ok(private.mkt_contato_tem_os((SELECT id FROM public.mkt_contatos WHERE nome = 'Confirmada Fictícia'), NULL),
  'OS antiga com visita Confirmado: tem OS');
SELECT pg_temp.ok(private.mkt_contato_tem_os((SELECT id FROM public.mkt_contatos WHERE nome = 'Caminho Fictícia'), NULL),
  'OS antiga com visita Em deslocamento: tem OS');
SELECT pg_temp.ok(NOT private.mkt_contato_tem_os((SELECT id FROM public.mkt_contatos WHERE nome = 'Cancelada Fictícia'), NULL),
  'OS antiga só com visita cancelada: não tem OS');

ROLLBACK;
