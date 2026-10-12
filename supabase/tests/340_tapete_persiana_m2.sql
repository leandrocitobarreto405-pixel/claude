-- Tapete (m²) e persiana: categorias novas, quantidade com casas decimais e unidade na OS.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO public.tabela_precos_itens (empresa_id, nome, preco_higienizacao, preco_impermeabilizacao, categoria)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tapete teste (por m²)', 62.40, 103, 'tapete'),
       ('11111111-1111-1111-1111-111111111111', 'Persiana teste', 150, NULL, 'persiana');
SELECT pg_temp.ok((SELECT count(*) FROM public.tabela_precos_itens WHERE categoria IN ('tapete', 'persiana')) = 2,
  'categorias novas aceitas');
DO $$
BEGIN
  INSERT INTO public.tabela_precos_itens (empresa_id, nome, preco_higienizacao, categoria)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Inválido', 10, 'carro');
  RAISE EXCEPTION 'FALHOU: aceitou categoria desconhecida';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- Orçamento com 3,68 m².
INSERT INTO public.quotes (empresa_id, cliente_nome, subtotal, desconto, total)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tapete m2', 229.63, 0, 229.63);
INSERT INTO public.quote_items (empresa_id, quote_id, nome_snapshot, tipo_servico, preco_tabela, preco_aplicado, quantidade, subtotal, categoria)
SELECT '11111111-1111-1111-1111-111111111111', id, 'Tapete teste (por m²)', 'higienizacao', 62.40, 62.40, 3.68, 229.63, 'tapete'
  FROM public.quotes WHERE cliente_nome = 'Tapete m2';
SELECT pg_temp.ok((SELECT quantidade FROM public.quote_items WHERE nome_snapshot = 'Tapete teste (por m²)') = 3.68,
  'quantidade com vírgula no orçamento');

-- Item da OS: unidade padrão "un", m² guardado com 2 casas.
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c3400000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente m2', '11900000034');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id)
VALUES ('e3400000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '34001', 'c3400000-0000-0000-0000-000000000001');
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status)
VALUES ('f3400000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e3400000-0000-0000-0000-000000000001', current_date, '09:00', 'Agendado');
INSERT INTO public.service_items (empresa_id, visit_id, description, quantity, unit_price, subtotal, unidade) VALUES
  ('11111111-1111-1111-1111-111111111111', 'f3400000-0000-0000-0000-000000000001', 'Tapete', 3.68, 62.40, 229.63, 'm2');
INSERT INTO public.service_items (empresa_id, visit_id, description, quantity, unit_price, subtotal) VALUES
  ('11111111-1111-1111-1111-111111111111', 'f3400000-0000-0000-0000-000000000001', 'Sofá', 2, 100, 200);
SELECT pg_temp.ok((SELECT unidade || ':' || quantity FROM public.service_items WHERE description = 'Tapete') = 'm2:3.68', 'm² na OS');
SELECT pg_temp.ok((SELECT unidade || ':' || quantity FROM public.service_items WHERE description = 'Sofá') = 'un:2.00', 'peça continua');
DO $$
BEGIN
  UPDATE public.service_items SET unidade = 'kg' WHERE description = 'Sofá';
  RAISE EXCEPTION 'FALHOU: aceitou unidade desconhecida';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

ROLLBACK;
