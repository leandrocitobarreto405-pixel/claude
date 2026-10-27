-- Contadora (migração 20261228140000): fora da equipe, não lê conversas, mensagens, leads,
-- orçamentos, Alice, comissões nem outra empresa; lê só OS realizadas, notas e despesas da empresa
-- dela pelas funções contadora_*; não conta no limite de usuários. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated',
                             'email', _email)::text, false),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, false);
$$;
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set A '82000000-0000-4000-8000-00000000000a'
\set B '82000000-0000-4000-8000-00000000000b'
\set CA '82000000-0000-4000-8000-0000000000c1'
\set CB '82000000-0000-4000-8000-0000000000c2'
\set OA '82000000-0000-4000-8000-0000000000d1'
\set OB '82000000-0000-4000-8000-0000000000d2'
\set OX '82000000-0000-4000-8000-0000000000d3'
INSERT INTO public.empresas (id, nome) VALUES (:'A', 'Empresa Fictícia A 820'), (:'B', 'Empresa Fictícia B 820');
INSERT INTO auth.users (email) VALUES ('admin-a@p820.test'), ('contadora@p820.test'), ('admin-b@p820.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'A', 'admin' FROM auth.users WHERE email = 'admin-a@p820.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'B', 'admin' FROM auth.users WHERE email = 'admin-b@p820.test';

-- Limite do plano: 1 usuário (o admin já ocupa).
INSERT INTO public.assinaturas (empresa_id, plano_id, vigencia_inicio, status)
SELECT :'A', id, current_date - 1, 'ativa' FROM public.planos WHERE codigo = 'essencial';
UPDATE public.planos SET limite_usuarios = 1 WHERE codigo = 'essencial';
SELECT pg_temp.ok(private.usuarios_que_contam(:'A') = 1, 'admin conta 1');

-- Dados da empresa A e da B (OS concluída, nota, despesa, conversa, lead, orçamento).
INSERT INTO public.customers (id, empresa_id, full_name, phone, email, document_number, full_address) VALUES
  (:'CA', :'A', 'Cliente Fictício A', '11982000001', 'a@exemplo.com', '000.000.001-91', 'Rua Exemplo, 1 — São Paulo/SP'),
  (:'CB', :'B', 'Cliente Fictício B', '11982000002', 'b@exemplo.com', null, null);
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, status, total_gross_value) VALUES
  (:'OA', :'A', 'A820', :'CA', 'Concluída', 300),
  (:'OX', :'A', 'X820', :'CA', 'Agendada', 200),
  (:'OB', :'B', 'B820', :'CB', 'Concluída', 500);
-- O repasse vem dos itens de parceiro; aqui é fixado direto (gatilho desligado só neste teste).
ALTER TABLE public.visits DISABLE TRIGGER trg_visits_repasse_parceiro;
INSERT INTO public.visits (empresa_id, work_order_id, scheduled_date, scheduled_time, status, completion_date, visit_value, repasse_parceiro, upholstery_description) VALUES
  (:'A', :'OA', current_date - 3, '10:00', 'Concluído', current_date - 3, 300, 120, 'Sofá 3 lugares'),
  (:'A', :'OX', current_date + 3, '10:00', 'Agendado', null, 200, 0, 'Cadeiras'),
  (:'B', :'OB', current_date - 3, '10:00', 'Concluído', current_date - 3, 500, 0, 'Tapete');
INSERT INTO public.payments (empresa_id, work_order_id, payment_channel, payment_type, gross_amount, payment_status, payment_date)
VALUES (:'A', :'OA', 'Pix', 'Pix', 300, 'Pago', current_date - 3);
INSERT INTO public.invoice_tasks (empresa_id, work_order_id, customer_id, status, invoice_amount, service_date) VALUES
  (:'A', :'OA', :'CA', 'Pendente', 300, current_date - 3),
  (:'B', :'OB', :'CB', 'Pendente', 500, current_date - 3);
INSERT INTO public.expenses (empresa_id, description, category, competence_date, expected_amount, status, beneficiary) VALUES
  (:'A', 'Produto de limpeza', 'Insumos', current_date, 80, 'Pendente', 'Fornecedor Fictício'),
  (:'B', 'Aluguel', 'Fixas', current_date, 900, 'Pendente', 'Imobiliária Fictícia');
INSERT INTO public.crm_leads (empresa_id, lead_name, phone, normalized_phone, first_contact_date)
VALUES (:'A', 'Lead Fictício A', '11982000009', '5511982000009', current_date);
INSERT INTO public.quotes (empresa_id, numero, cliente_nome, status, total) VALUES (:'A', 9820, 'Cliente Fictício A', 'enviado', 300);
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('82000000-0000-4000-8000-0000000000cc', 'Nexa 820', 820, 'token-p820');
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone) VALUES ('82000000-0000-4000-8000-0000000000e1', :'A', '5511982000009');
INSERT INTO public.conversas (empresa_id, conexao_id, chatwoot_conversation_id, whatsapp_contact_id, status)
VALUES (:'A', '82000000-0000-4000-8000-0000000000cc', 8201, '82000000-0000-4000-8000-0000000000e1', 'open');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, text_content)
VALUES (:'A', '82000000-0000-4000-8000-0000000000e1', 'Recebida', 'oi');

-- 1) Admin da A convida a contadora (mesmo com o limite cheio) e ela aceita no login.
SELECT pg_temp.como('admin-a@p820.test', :'A');
SET ROLE authenticated;
INSERT INTO public.convites_contadora (empresa_id, email) VALUES (:'A', 'contadora@p820.test');
RESET ROLE;
SELECT pg_temp.como('contadora@p820.test', :'A');
SET ROLE authenticated;
SELECT public.ensure_my_access();
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.contadoras_empresa c JOIN auth.users u ON u.id = c.user_id
                    WHERE u.email = 'contadora@p820.test' AND c.empresa_id = :'A') = 1, 'convite aceito: vínculo criado');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.usuarios_empresa ue JOIN auth.users u ON u.id = ue.user_id
                               WHERE u.email = 'contadora@p820.test'), 'contadora não entra na equipe');
SELECT pg_temp.ok(private.usuarios_que_contam(:'A') = 1, 'contadora não conta no limite de usuários');

-- 2) Como contadora, na empresa A: nada das tabelas da equipe.
SELECT pg_temp.como('contadora@p820.test', :'A');
SET ROLE authenticated;
SELECT pg_temp.ok(private.empresa_ativa() IS NULL, 'sem empresa ativa (fora da equipe)');
SELECT pg_temp.ok((SELECT count(*) FROM public.conversas) = 0, 'não lê conversas');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_messages) = 0, 'não lê mensagens');
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_leads) = 0, 'não lê leads');
SELECT pg_temp.ok((SELECT count(*) FROM public.quotes) = 0, 'não lê orçamentos');
SELECT pg_temp.ok((SELECT count(*) FROM public.ia_configuracoes) = 0, 'não lê configuração da Alice');
SELECT pg_temp.ok((SELECT count(*) FROM public.ia_tarefas) = 0, 'não lê tarefas da Alice');
SELECT pg_temp.ok((SELECT count(*) FROM public.salespeople) = 0, 'não lê vendedoras (comissões)');
SELECT pg_temp.ok((SELECT count(*) FROM public.work_orders) = 0, 'não lê OS direto');
SELECT pg_temp.ok((SELECT count(*) FROM public.customers) = 0, 'não lê clientes direto');
SELECT pg_temp.ok((SELECT count(*) FROM public.invoice_tasks) = 0, 'não lê notas direto');
SELECT pg_temp.ok((SELECT count(*) FROM public.expenses) = 0, 'não lê despesas direto');
UPDATE public.invoice_tasks SET status = 'Emitida';
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.invoice_tasks WHERE status = 'Emitida') = 0, 'não grava nota direto');
SET ROLE authenticated;

-- 3) Pelas funções: só OS realizadas, notas e despesas da A.
SELECT pg_temp.ok(public.contadora_pode(:'A'), 'pode na A');
SELECT pg_temp.ok(NOT public.contadora_pode(:'B'), 'não pode na B');
SELECT pg_temp.ok(jsonb_array_length(public.contadora_os_realizadas(:'A', current_date - 30, current_date)) = 1, 'uma OS realizada (a agendada não entra)');
SELECT pg_temp.ok((public.contadora_os_realizadas(:'A', current_date - 30, current_date)->0->>'os') = 'A820', 'OS certa');
SELECT pg_temp.ok((public.contadora_os_realizadas(:'A', current_date - 30, current_date)->0->>'pagamento') = 'Pix', 'forma de pagamento recebida');
SELECT pg_temp.ok((public.contadora_os_realizadas(:'A', current_date - 30, current_date)->0->>'repasse_total')::numeric = 120, 'repasse do parceiro');
SELECT pg_temp.ok((public.contadora_os_realizadas(:'A', current_date - 30, current_date)->0->>'documento') = '000.000.001-91', 'CPF do cliente');
SELECT pg_temp.ok(jsonb_array_length(public.contadora_notas(:'A')) = 1, 'fila para emitir da A');
SELECT pg_temp.ok(jsonb_array_length(public.contadora_despesas(:'A', current_date - 30, current_date + 30)) = 1, 'despesa da A');
SELECT pg_temp.deve_falhar(format('SELECT public.contadora_os_realizadas(%L, current_date - 30, current_date)', :'B'), 'OS da B bloqueada');
SELECT pg_temp.deve_falhar(format('SELECT public.contadora_notas(%L)', :'B'), 'notas da B bloqueadas');
SELECT pg_temp.deve_falhar(format('SELECT public.contadora_despesas(%L, current_date - 30, current_date)', :'B'), 'despesas da B bloqueadas');
-- pedindo a B no cabeçalho também não adianta
RESET ROLE;
SELECT pg_temp.como('contadora@p820.test', :'B');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.work_orders) = 0, 'cabeçalho da B: nada');
SELECT pg_temp.ok((SELECT count(*) FROM public.contadoras_empresa) = 1, 'vê só o próprio vínculo');
SELECT pg_temp.ok((SELECT count(*) FROM public.contadora_minhas_empresas()) = 1, 'lista só a empresa A');
RESET ROLE;

-- 4) Admin da B não vê a contadora da A; admin da A vê e remove.
SELECT pg_temp.como('admin-b@p820.test', :'B');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.contadoras_empresa) = 0, 'admin da B não vê contadora da A');
SELECT pg_temp.deve_falhar(format('SELECT public.contadora_os_realizadas(%L, current_date - 30, current_date)', :'A'), 'admin da B não lê a A');
RESET ROLE;
SELECT pg_temp.como('admin-a@p820.test', :'A');
SET ROLE authenticated;
SELECT pg_temp.ok(jsonb_array_length(public.contadora_os_realizadas(:'A', current_date - 30, current_date)) = 1, 'admin da A confere a tela');
DELETE FROM public.contadoras_empresa;
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.contadoras_empresa WHERE empresa_id = :'A') = 0, 'admin removeu a contadora');
SELECT pg_temp.como('contadora@p820.test', :'A');
SET ROLE authenticated;
SELECT pg_temp.ok(NOT public.contadora_pode(:'A'), 'removida: perde o acesso');
RESET ROLE;
ROLLBACK;
