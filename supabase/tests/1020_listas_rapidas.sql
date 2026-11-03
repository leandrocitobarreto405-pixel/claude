-- Listas do Marketing rápidas (migração 20261228430000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

-- Índices existem.
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_quotes_telefone_chave'), 'índice dos orçamentos por telefone');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_customers_telefone_chave'), 'índice dos clientes por telefone');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_work_orders_customer'), 'índice das OS por cliente');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_visits_work_order'), 'índice das visitas por OS');

-- Empresa fictícia com um cliente, uma OS com visita marcada e um orçamento sem lead.
\set E '99000000-0000-4000-8000-00000000001c'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 1020');
INSERT INTO public.customers (id, empresa_id, full_name, phone)
  VALUES ('99000000-0000-4000-8000-00000000002c', :'E', 'Cliente Fictício', '(11) 99999-1020');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, status, sale_date)
  VALUES ('99000000-0000-4000-8000-00000000003c', :'E', 'F-1020', '99000000-0000-4000-8000-00000000002c', 'Agendada', current_date);
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status)
  VALUES ('99000000-0000-4000-8000-00000000004c', :'E', '99000000-0000-4000-8000-00000000003c', current_date + 3, '10:00', 'Agendado');
INSERT INTO public.quotes (id, empresa_id, cliente_nome, cliente_telefone, status, total)
  VALUES ('99000000-0000-4000-8000-00000000007c', :'E', 'Outro Fictício', '11 99999-1021', 'enviado', 500);

-- Contatos de marketing ligados só pelo telefone (sem customer_id e sem lead).
INSERT INTO public.mkt_contatos (id, empresa_id, nome, normalized_phone, tipo)
  VALUES ('99000000-0000-4000-8000-00000000005c', :'E', 'Cliente Fictício', '5511999991020', 'nao_comprador')
  ON CONFLICT DO NOTHING;
INSERT INTO public.mkt_contatos (id, empresa_id, nome, normalized_phone, tipo)
  VALUES ('99000000-0000-4000-8000-00000000006c', :'E', 'Outro Fictício', '5511999991021', 'nao_comprador')
  ON CONFLICT DO NOTHING;
UPDATE public.mkt_contatos SET customer_id = NULL, crm_lead_id = NULL
 WHERE empresa_id = :'E';
\set C1 '(SELECT id FROM public.mkt_contatos WHERE empresa_id = ''99000000-0000-4000-8000-00000000001c'' AND private.telefone_chave(normalized_phone) = ''1199991020'')'
\set C2 '(SELECT id FROM public.mkt_contatos WHERE empresa_id = ''99000000-0000-4000-8000-00000000001c'' AND private.telefone_chave(normalized_phone) = ''1199991021'')'

-- OS do contato achada pelo telefone; sem OS fica falso.
SELECT pg_temp.ok(private.mkt_contato_tem_os(:C1, current_date), 'contato pelo telefone tem OS');
SELECT pg_temp.ok(NOT private.mkt_contato_tem_os(:C2, current_date), 'contato sem OS');

-- Dados das listas: visita marcada e OS pelo telefone; orçamento pelo telefone.
SELECT pg_temp.ok((SELECT agendado_para FROM private.mkt_listas_dados(:'E', current_date) WHERE contato_id = :C1) = current_date + 3, 'visita marcada achada pelo telefone');
SELECT pg_temp.ok((SELECT tem_os FROM private.mkt_listas_dados(:'E', current_date) WHERE contato_id = :C1), 'tem_os pelo telefone');
SELECT pg_temp.ok((SELECT agendado_para FROM private.mkt_listas_dados(:'E', current_date) WHERE contato_id = :C2) IS NULL, 'sem visita marcada');
SELECT pg_temp.ok((SELECT orcamento_valor FROM private.mkt_listas_dados(:'E', current_date) WHERE contato_id = :C2) = 500, 'orçamento achado pelo telefone');
SELECT pg_temp.ok((SELECT em_orcamento FROM private.mkt_listas_dados(:'E', current_date) WHERE contato_id = :C2), 'em orçamento');
-- A contagem do plano responde para a empresa fictícia.
SELECT pg_temp.ok(jsonb_typeof(public.comercial_listas_contagem(:'E', '{"N1:30": {"orcamento": {"ate": 30}}}'::jsonb)) = 'object', 'contagem do plano responde');
ROLLBACK;
