-- Testes do funil (Etapa 4): vínculo orçamento → lead, marcos automáticos, conversão em OS,
-- etapa canônica e indicadores. Rodam numa transação desfeita no final.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

CREATE FUNCTION pg_temp.deve_falhar(_sql text, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (deveria ter sido bloqueado): %', _msg;
END $$;

CREATE FUNCTION pg_temp.lead(_id text) RETURNS public.crm_leads LANGUAGE sql AS $$
  SELECT * FROM public.crm_leads WHERE id = _id::uuid;
$$;
CREATE FUNCTION pg_temp.etapa(_id text) RETURNS text LANGUAGE sql AS $$
  SELECT public.etapa(l) FROM public.crm_leads l WHERE id = _id::uuid;
$$;

-- ---------------------------------------------------------------- cenário
-- T = Turbine (111…), B = Cliente B (222…).
INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Cliente B');

INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Maria', '11911112222');

-- L1: lead do Chatwoot respondido em 15 min; L2: lead que vai desistir; L3: lead para desvincular;
-- LB: lead da empresa B com o MESMO telefone de L1.
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, first_contact_date,
  created_at, primeira_resposta_em, status_id, is_open) VALUES
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Maria',
   '11911112222', '5511911112222', '2026-09-10', '2026-09-10 12:00-03', '2026-09-10 12:15-03',
   (SELECT id FROM public.config_options WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
      AND kind = 'crm_status' AND name = 'Novo contato'), true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Pedro',
   '11933334444', '5511933334444', '2026-09-11', '2026-09-11 09:00-03', NULL,
   (SELECT id FROM public.config_options WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
      AND kind = 'crm_status' AND name = 'Em atendimento'), true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Ana',
   '11955556666', '5511955556666', '2026-09-12', '2026-09-12 09:00-03', NULL, NULL, true),
  ('b1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Maria em B',
   '11911112222', '5511911112222', '2026-09-10', '2026-09-10 13:00-03', NULL, NULL, true);

-- Conversa do Chatwoot para medir o tempo de primeira resposta de L1.
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('33333333-3333-3333-3333-333333333333', 'Nexa', 187966, 'token-teste');
INSERT INTO public.conversas (empresa_id, conexao_id, chatwoot_conversation_id, crm_lead_id) VALUES
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 1,
   'a1000000-0000-0000-0000-000000000001');

SELECT pg_temp.ok(pg_temp.etapa('a1000000-0000-0000-0000-000000000001') = 'em_atendimento',
  'lead respondido está em atendimento');
SELECT pg_temp.ok(pg_temp.etapa('a1000000-0000-0000-0000-000000000003') = 'novo', 'lead sem resposta é novo');

-- 1. Orçamento sem lead é ligado ao lead aberto com o mesmo telefone (e da mesma empresa).
INSERT INTO public.quotes (id, empresa_id, cliente_nome, cliente_telefone, total, status, created_at, lucro_percentual)
VALUES ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Maria',
        '(11) 91111-2222', 500, 'rascunho', '2026-09-10 15:00-03', 30);
SELECT pg_temp.ok((SELECT crm_lead_id FROM public.quotes WHERE id = 'd1000000-0000-0000-0000-000000000001')
  = 'a1000000-0000-0000-0000-000000000001', 'orçamento ligado ao lead da Turbine pelo telefone');
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000001')).orcamento_em = '2026-09-10 15:00-03',
  'marco de orçamento = criação do orçamento');
SELECT pg_temp.ok(pg_temp.etapa('a1000000-0000-0000-0000-000000000001') = 'orcamento', 'etapa orçamento');

-- 2. Enviado e aprovado.
UPDATE public.quotes SET status = 'enviado' WHERE id = 'd1000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000001')).orcamento_enviado_em IS NOT NULL,
  'marco de orçamento enviado');
SELECT pg_temp.ok(pg_temp.etapa('a1000000-0000-0000-0000-000000000001') = 'orcamento_enviado', 'etapa enviado');
UPDATE public.quotes SET status = 'aprovado' WHERE id = 'd1000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000001')).orcamento_aprovado_em IS NOT NULL,
  'marco de orçamento aprovado');

-- 3. Orçamento vira OS: o lead é convertido (OS vinculada, encerrado, status "Agendado", histórico).
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date, created_at)
VALUES ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '9001',
        'c1000000-0000-0000-0000-000000000001', 480, '2026-09-13', '2026-09-13 10:00-03');
UPDATE public.quotes SET status = 'convertido', generated_work_order_id = 'e1000000-0000-0000-0000-000000000001'
 WHERE id = 'd1000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT linked_work_order_id = 'e1000000-0000-0000-0000-000000000001' AND NOT is_open
    AND closed_at IS NOT NULL FROM public.crm_leads WHERE id = 'a1000000-0000-0000-0000-000000000001'),
  'lead convertido e encerrado');
SELECT pg_temp.ok((SELECT s.name FROM public.crm_leads l JOIN public.config_options s ON s.id = l.status_id
  WHERE l.id = 'a1000000-0000-0000-0000-000000000001') = 'Agendado', 'status de convertido aplicado');
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_status_history WHERE crm_lead_id = 'a1000000-0000-0000-0000-000000000001'
  AND new_status_name = 'Agendado' AND change_source = 'Orçamento') = 1, 'histórico de status registrado');
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000001')).os_criada_em = '2026-09-13 10:00-03',
  'marco de OS = criação da OS');
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000001')).perdido_em IS NULL,
  'lead convertido não conta como perdido');

-- 4. Atendimento agendado e realizado.
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status, created_at)
VALUES ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'e1000000-0000-0000-0000-000000000001', '2026-09-15', '09:00', 'Agendado', '2026-09-13 10:01-03');
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000001')).agendado_em = '2026-09-13 10:01-03',
  'marco de agendamento');
UPDATE public.visits SET status = 'Concluído', completion_date = '2026-09-15', completion_time = '11:30'
 WHERE id = 'f1000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000001')).realizado_em = '2026-09-15 11:30-03',
  'marco de realização = conclusão do atendimento (horário de São Paulo)');
SELECT pg_temp.ok(pg_temp.etapa('a1000000-0000-0000-0000-000000000001') = 'realizado', 'etapa realizado');

-- 5. Pagamento: só "Pago" e ativo fatura; reabertura desfaz.
INSERT INTO public.payments (id, empresa_id, work_order_id, payment_channel, payment_date, gross_amount,
  net_amount, payment_status, is_active)
VALUES ('91000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'e1000000-0000-0000-0000-000000000001', 'Pix', '2026-09-15', 480, 480, 'Não pago', true);
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000001')).faturado_em IS NULL,
  'pagamento pendente não fatura');
UPDATE public.payments SET payment_status = 'Pago' WHERE id = '91000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000001')).faturado_em = '2026-09-15 12:00-03',
  'pagamento pago fatura');
SELECT pg_temp.ok(pg_temp.etapa('a1000000-0000-0000-0000-000000000001') = 'faturado', 'etapa faturado');
UPDATE public.payments SET is_active = false WHERE id = '91000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000001')).faturado_em IS NULL,
  'pagamento reaberto desfaz o faturamento');
UPDATE public.payments SET is_active = true WHERE id = '91000000-0000-0000-0000-000000000001';

-- 6. Perdido: desistiu → perdido; reaberto → deixa de ser perdido.
UPDATE public.crm_leads SET is_open = false, closed_at = '2026-09-14 10:00-03',
  status_id = (SELECT id FROM public.config_options WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
                 AND kind = 'crm_status' AND name = 'Desistiu')
 WHERE id = 'a1000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000002')).perdido_em = '2026-09-14 10:00-03',
  'lead desistente marcado como perdido');
SELECT pg_temp.ok(pg_temp.etapa('a1000000-0000-0000-0000-000000000002') = 'perdido', 'etapa perdido');
UPDATE public.crm_leads SET is_open = true WHERE id = 'a1000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000002')).perdido_em IS NULL,
  'lead reaberto deixa de ser perdido');
UPDATE public.crm_leads SET is_open = false WHERE id = 'a1000000-0000-0000-0000-000000000002';
-- Lead perdido que depois vira OS (sem trocar o status) deixa de contar como perdido.
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date)
VALUES ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '9002',
        'c1000000-0000-0000-0000-000000000001', 100, '2026-10-05');
UPDATE public.crm_leads SET linked_work_order_id = 'e1000000-0000-0000-0000-000000000002'
 WHERE id = 'a1000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000002')).perdido_em IS NULL,
  'lead com OS não é perdido, mesmo com status de desistência');
UPDATE public.crm_leads SET linked_work_order_id = NULL WHERE id = 'a1000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000002')).perdido_em IS NOT NULL,
  'sem a OS volta a ser perdido');

-- 7. Orçamento não liga a lead encerrado.
INSERT INTO public.quotes (id, empresa_id, cliente_nome, cliente_telefone, total, status)
VALUES ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Pedro',
        '11933334444', 300, 'rascunho');
SELECT pg_temp.ok((SELECT crm_lead_id FROM public.quotes WHERE id = 'd1000000-0000-0000-0000-000000000002') IS NULL,
  'orçamento não é ligado a lead encerrado');

-- 8. Desvincular recalcula o lead.
INSERT INTO public.quotes (id, empresa_id, cliente_nome, cliente_telefone, total, status)
VALUES ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Ana',
        '11955556666', 200, 'enviado');
SELECT pg_temp.ok((pg_temp.lead('a1000000-0000-0000-0000-000000000003')).orcamento_enviado_em IS NOT NULL,
  'orçamento criado já enviado marca o envio');
UPDATE public.quotes SET crm_lead_id = NULL WHERE id = 'd1000000-0000-0000-0000-000000000003';
SELECT pg_temp.ok((SELECT orcamento_em IS NULL AND orcamento_enviado_em IS NULL FROM public.crm_leads
  WHERE id = 'a1000000-0000-0000-0000-000000000003'), 'desvincular limpa os marcos do lead');
SELECT pg_temp.ok((SELECT crm_lead_id FROM public.quotes WHERE id = 'd1000000-0000-0000-0000-000000000003') IS NULL,
  'desvinculado continua desvinculado');

-- 9. Referência a lead de outra empresa é recusada.
SELECT pg_temp.deve_falhar($q$UPDATE public.quotes SET crm_lead_id = 'b1000000-0000-0000-0000-000000000001'
  WHERE id = 'd1000000-0000-0000-0000-000000000003'$q$, 'orçamento da Turbine ligado a lead da empresa B');

-- 10. Indicadores do período (coorte 10–12/09 da Turbine: L1, L2, L3).
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'turbine@teste.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@teste.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'admin');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE ind AS SELECT public.indicadores_funil('2026-09-10', '2026-09-12') AS v;
SELECT pg_temp.ok((SELECT (v->'funil'->>'leads')::int FROM ind) = 3, 'três leads na coorte');
SELECT pg_temp.ok((SELECT (v->'funil'->>'orcamento')::int FROM ind) = 1, 'um lead com orçamento');
SELECT pg_temp.ok((SELECT (v->'funil'->>'os_criada')::int FROM ind) = 1, 'um lead virou OS');
SELECT pg_temp.ok((SELECT (v->'funil'->>'faturado')::int FROM ind) = 1, 'um lead faturado');
SELECT pg_temp.ok((SELECT (v->'funil'->>'perdidos')::int FROM ind) = 1, 'um lead perdido');
SELECT pg_temp.ok((SELECT (v->'funil'->>'atendidos')::int FROM ind) = 1,
  'atendidos: só quem teve resposta ou avançou (perdido sem resposta não conta)');
SELECT pg_temp.ok((SELECT (v->'atendimento'->>'primeira_resposta_mediana_min')::numeric FROM ind) = 15,
  'mediana da primeira resposta = 15 min');
SELECT pg_temp.ok((SELECT (v->'valores'->>'orcado')::numeric FROM ind) = 500, 'valor orçado da coorte');
SELECT pg_temp.ok((SELECT (v->'valores'->>'vendido')::numeric FROM ind) = 480, 'valor vendido da coorte');
SELECT pg_temp.ok((SELECT (v->'valores'->>'recebido')::numeric FROM ind) = 480, 'valor recebido da coorte');
SELECT pg_temp.ok((SELECT (v->'etapas'->>'faturado')::int FROM ind) = 1, 'distribuição por etapa');

CREATE TEMP TABLE ind_mes AS SELECT public.indicadores_funil('2026-09-01', '2026-09-30') AS v;
SELECT pg_temp.ok((SELECT (v->'periodo_geral'->>'os')::int FROM ind_mes) = 1, 'OS no mês');
SELECT pg_temp.ok((SELECT (v->'periodo_geral'->>'recebido')::numeric FROM ind_mes) = 480, 'recebido no mês');
SELECT pg_temp.ok((SELECT (v->'periodo_geral'->>'ticket_medio')::numeric FROM ind_mes) = 480, 'ticket médio');
RESET ROLE;

-- 11. Isolamento: a empresa B só vê o próprio lead nos indicadores.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.indicadores_funil('2026-09-10', '2026-09-12')->'funil'->>'leads')::int = 1,
  'empresa B vê só o próprio lead');
SELECT pg_temp.ok((public.indicadores_funil('2026-09-01', '2026-09-30')->'periodo_geral'->>'recebido')::numeric = 0,
  'empresa B não vê recebimentos da Turbine');
SELECT pg_temp.deve_falhar($q$SELECT private.atualizar_marcos_lead('a1000000-0000-0000-0000-000000000001')$q$,
  'usuário chamando o recálculo interno');
RESET ROLE;

-- 12. OS excluída desfaz os marcos de OS em diante.
UPDATE public.work_orders SET deleted_at = now() WHERE id = 'e1000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT os_criada_em IS NULL AND agendado_em IS NULL AND faturado_em IS NULL
  FROM public.crm_leads WHERE id = 'a1000000-0000-0000-0000-000000000001'), 'OS excluída limpa os marcos');

ROLLBACK;
