-- Terceirizados: custo do parceiro congelado na linha da OS, repasse como despesa pendente ao
-- concluir (cancelada se reabrir), técnico parceiro sem login/e-mail. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'

-- Parceiro: sem login e sem e-mail.
INSERT INTO public.technicians (id, empresa_id, name, parceiro)
VALUES ('d4300000-0000-0000-0000-000000000001', :'E', 'Parceiro Fictício', true);
DO $$
BEGIN
  UPDATE public.technicians SET email = 'parceiro@exemplo.invalid'
   WHERE id = 'd4300000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: parceiro aceitou e-mail';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- Itens: terceirizado com custo de limpeza e de imper (categoria "outro": a impermeabilização de
-- tapete nunca tem repasse, ver 760) e sofá próprio.
INSERT INTO public.tabela_precos_itens (id, empresa_id, nome, preco_higienizacao, preco_impermeabilizacao,
  categoria, terceirizado, custo_parceiro, custo_parceiro_impermeabilizacao, parceiro_id) VALUES
  ('b4300000-0000-0000-0000-000000000001', :'E', 'Tapete fictício (por m²)', 60, 100, 'outro', true, 30, 55,
   'd4300000-0000-0000-0000-000000000001'),
  ('b4300000-0000-0000-0000-000000000002', :'E', 'Sofá fictício', 200, 400, 'sofa', false, NULL, NULL, NULL);

INSERT INTO public.customers (id, empresa_id, full_name, phone)
VALUES ('c4300000-0000-0000-0000-000000000001', :'E', 'Cliente Fictício', '11943000001');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date)
VALUES ('e4300000-0000-0000-0000-000000000001', :'E', '43001', 'c4300000-0000-0000-0000-000000000001', 600, current_date);
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status, technician_id, visit_value)
VALUES ('f4300000-0000-0000-0000-000000000001', :'E', 'e4300000-0000-0000-0000-000000000001', current_date, '09:00',
        'Agendado', 'd4300000-0000-0000-0000-000000000001', 600);
INSERT INTO public.service_items (empresa_id, visit_id, description, quantity, unit_price, subtotal, unidade) VALUES
  (:'E', 'f4300000-0000-0000-0000-000000000001', 'Tapete fictício (por m²) — Limpeza', 4, 60, 240, 'm2'),
  (:'E', 'f4300000-0000-0000-0000-000000000001', 'Tapete fictício (por m²) — Impermeabilização', 2, 100, 200, 'm2'),
  (:'E', 'f4300000-0000-0000-0000-000000000001', 'Sofá fictício — Higienização', 1, 160, 160, 'un');

-- 1) custo congelado pela descrição; sofá sem repasse
SELECT pg_temp.ok((SELECT custo_parceiro_unitario || '/' || repasse_parceiro FROM public.service_items
                    WHERE description LIKE '%— Limpeza') = '30.00/120.00', 'limpeza: 4 m² × 30 = 120');
SELECT pg_temp.ok((SELECT custo_parceiro_unitario || '/' || repasse_parceiro FROM public.service_items
                    WHERE description LIKE '%— Impermeabilização') = '55.00/110.00', 'imper: 2 m² × 55 = 110');
SELECT pg_temp.ok((SELECT tabela_preco_item_id = 'b4300000-0000-0000-0000-000000000002' AND repasse_parceiro = 0
                     AND parceiro_id IS NULL FROM public.service_items WHERE description LIKE 'Sofá%'),
  'sofá ligado ao item, sem repasse');
SELECT pg_temp.ok((SELECT bool_and(parceiro_id = 'd4300000-0000-0000-0000-000000000001') FROM public.service_items
                    WHERE description LIKE 'Tapete%'), 'parceiro na linha');

-- Mudar o custo na tabela não muda a OS já vendida.
UPDATE public.tabela_precos_itens SET custo_parceiro = 99 WHERE id = 'b4300000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT custo_parceiro_unitario FROM public.service_items WHERE description LIKE '%— Limpeza') = 30,
  'custo congelado na venda');
-- Quantidade editada: repasse acompanha.
UPDATE public.service_items SET quantity = 5 WHERE description LIKE '%— Limpeza';
SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.service_items WHERE description LIKE '%— Limpeza') = 150,
  'repasse acompanha a quantidade');

SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.visits WHERE id = 'f4300000-0000-0000-0000-000000000001') = 260,
  'total do repasse no atendimento (150 + 110)');

-- 2) nada a pagar antes de concluir
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.expenses WHERE reference_key = 'repasse:f4300000-0000-0000-0000-000000000001'),
  'sem despesa antes da conclusão');

-- 3) concluir cria a despesa pendente vencendo na conclusão
UPDATE public.visits SET status = 'Concluído', completion_date = current_date - 1
 WHERE id = 'f4300000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT expected_amount = 260 AND status = 'Pendente' AND due_date = current_date - 1
                     AND competence_date = current_date - 1 AND category = 'Repasse a parceiro'
                     AND beneficiary = 'Parceiro Fictício'
                     FROM public.expenses WHERE reference_key = 'repasse:f4300000-0000-0000-0000-000000000001'),
  'despesa pendente de 260 (150 + 110) vencendo na conclusão');

-- Item desativado depois de concluído: despesa ajustada.
UPDATE public.service_items SET active = false WHERE description LIKE '%— Impermeabilização';
SELECT pg_temp.ok((SELECT expected_amount FROM public.expenses
                    WHERE reference_key = 'repasse:f4300000-0000-0000-0000-000000000001') = 150,
  'despesa acompanha os itens');
SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.visits WHERE id = 'f4300000-0000-0000-0000-000000000001') = 150,
  'total do atendimento sem o item desativado');

-- 4) reabrir cancela a despesa ainda não paga (sem apagar)
UPDATE public.visits SET status = 'Agendado' WHERE id = 'f4300000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT status FROM public.expenses
                    WHERE reference_key = 'repasse:f4300000-0000-0000-0000-000000000001') = 'Cancelado',
  'reaberto: despesa cancelada');
UPDATE public.visits SET status = 'Concluído' WHERE id = 'f4300000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT count(*) FROM public.expenses
                    WHERE reference_key = 'repasse:f4300000-0000-0000-0000-000000000001' AND deleted_at IS NULL) = 1
                  AND (SELECT status FROM public.expenses
                    WHERE reference_key = 'repasse:f4300000-0000-0000-0000-000000000001') = 'Pendente',
  'concluído de novo: a mesma despesa volta a pendente');

-- 5) despesa paga não é mexida
UPDATE public.expenses SET status = 'Pago', paid_amount = 150, actual_amount = 150, payment_date = current_date
 WHERE reference_key = 'repasse:f4300000-0000-0000-0000-000000000001';
UPDATE public.visits SET status = 'Agendado' WHERE id = 'f4300000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT status FROM public.expenses
                    WHERE reference_key = 'repasse:f4300000-0000-0000-0000-000000000001') = 'Pago',
  'paga continua paga');

-- 6) OS de teste não gera despesa
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date, eh_teste)
VALUES ('e4300000-0000-0000-0000-000000000002', :'E', '43002', 'c4300000-0000-0000-0000-000000000001', 240, current_date, true);
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status, visit_value)
VALUES ('f4300000-0000-0000-0000-000000000002', :'E', 'e4300000-0000-0000-0000-000000000002', current_date, '09:00', 'Agendado', 240);
INSERT INTO public.service_items (empresa_id, visit_id, description, quantity, unit_price, subtotal, unidade)
VALUES (:'E', 'f4300000-0000-0000-0000-000000000002', 'Tapete fictício (por m²) — Limpeza', 4, 60, 240, 'm2');
UPDATE public.visits SET status = 'Concluído', completion_date = current_date
 WHERE id = 'f4300000-0000-0000-0000-000000000002';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.expenses WHERE reference_key = 'repasse:f4300000-0000-0000-0000-000000000002'),
  'OS de teste sem despesa de repasse');

-- 7) item sem custo preenchido: repasse zero, nenhuma despesa
UPDATE public.tabela_precos_itens SET custo_parceiro = NULL WHERE id = 'b4300000-0000-0000-0000-000000000001';
UPDATE public.work_orders SET eh_teste = false WHERE id = 'e4300000-0000-0000-0000-000000000002';
INSERT INTO public.service_items (empresa_id, visit_id, description, quantity, unit_price, subtotal, unidade)
VALUES (:'E', 'f4300000-0000-0000-0000-000000000002', 'Tapete fictício (por m²) — Limpeza', 1, 60, 60, 'm2');
SELECT pg_temp.ok((SELECT custo_parceiro_unitario IS NULL AND repasse_parceiro = 0 FROM public.service_items
                    WHERE visit_id = 'f4300000-0000-0000-0000-000000000002' AND quantity = 1),
  'sem custo: repasse zero');

ROLLBACK;
