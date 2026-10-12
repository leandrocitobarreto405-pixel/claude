-- Alice: uma execução por conversa (a segunda espera), cliente antigo só com serviço realizado e
-- um follow-up pendente por conversa. Dados fictícios.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

CREATE FUNCTION pg_temp.msg(_id int, _conversa int, _texto text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.receber_evento_chatwoot('token-fila', 'f' || _id, jsonb_build_object(
    'event', 'message_created', 'id', _id, 'message_type', 'incoming', 'content', _texto,
    'private', false, 'created_at', to_char(now() - interval '1 minute' + make_interval(secs => _id),
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'account', jsonb_build_object('id', 187977), 'inbox', jsonb_build_object('id', 33),
    'sender', jsonb_build_object('id', 700 + _conversa, 'type', 'contact'),
    'conversation', jsonb_build_object('id', _conversa, 'inbox_id', 33, 'status', 'pending',
      'channel', 'Channel::Whatsapp', 'updated_at', 1790000000 + _id,
      'meta', jsonb_build_object('sender', jsonb_build_object('id', 600 + _conversa,
        'name', 'Pessoa Teste ' || _conversa, 'phone_number', '+55119800' || lpad(_conversa::text, 5, '0'))))));
$$;

CREATE FUNCTION pg_temp.conversa(_conversa int) RETURNS public.conversas LANGUAGE sql AS $$
  SELECT * FROM public.conversas WHERE chatwoot_conversation_id = _conversa;
$$;

CREATE FUNCTION pg_temp.tarefas(_conversa int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(t.tipo || ':' || t.situacao, ',' ORDER BY t.tipo, t.situacao), '-')
    FROM public.ia_tarefas t WHERE t.conversa_id = (pg_temp.conversa(_conversa)).id;
$$;

CREATE FUNCTION pg_temp.pendente(_conversa int, _tipo text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.ia_tarefas
   WHERE conversa_id = (pg_temp.conversa(_conversa)).id AND tipo = _tipo AND situacao = 'pendente';
$$;

INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('77777777-7777-7777-7777-777777777777', 'Nexa fila', 187977, 'token-fila');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('77777777-7777-7777-7777-777777777777', 33, '11111111-1111-1111-1111-111111111111');
INSERT INTO public.ia_configuracoes (empresa_id, ativo, espera_segundos)
VALUES ('11111111-1111-1111-1111-111111111111', true, 8);

-- 1. Duas mensagens seguidas: a segunda tarefa não começa enquanto a primeira processa.
SELECT pg_temp.msg(1, 1, 'Oi, quero orçamento');
UPDATE public.ia_tarefas SET executar_apos = now() - interval '1 second' WHERE id = pg_temp.pendente(1, 'responder');
CREATE TEMP TABLE t1 AS SELECT pg_temp.pendente(1, 'responder') AS id;
SELECT pg_temp.ok((SELECT (public.ia_reservar_tarefa(id)).situacao FROM t1) = 'processando', 'primeira reserva');
SELECT pg_temp.msg(2, 1, 'É um sofá de 3 lugares');
CREATE TEMP TABLE t2 AS SELECT pg_temp.pendente(1, 'responder') AS id;
SELECT pg_temp.ok((SELECT id FROM t2) IS NOT NULL, 'segunda tarefa criada');
UPDATE public.ia_tarefas SET executar_apos = now() - interval '1 second', enfileirada = true WHERE id = (SELECT id FROM t2);
SELECT pg_temp.ok((SELECT (public.ia_reservar_tarefa(id)).id FROM t2) IS NULL, 'segunda não começa junto');
SELECT pg_temp.ok((SELECT situacao = 'pendente' AND NOT enfileirada AND executar_apos > now()
                     FROM public.ia_tarefas WHERE id = (SELECT id FROM t2)), 'segunda adiada e volta para a fila');
-- Passar para humano não espera.
INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo, motivo)
VALUES ('11111111-1111-1111-1111-111111111111', (pg_temp.conversa(1)).id, 'passar_para_humano', 'teste');
SELECT pg_temp.ok((SELECT (public.ia_reservar_tarefa(pg_temp.pendente(1, 'passar_para_humano'))).situacao) = 'processando',
  'passar para humano não espera');
-- Primeira terminou: a segunda começa.
UPDATE public.ia_tarefas SET situacao = 'concluida' WHERE id = (SELECT id FROM t1);
UPDATE public.ia_tarefas SET executar_apos = now() - interval '1 second' WHERE id = (SELECT id FROM t2);
SELECT pg_temp.ok((SELECT (public.ia_reservar_tarefa(id)).situacao FROM t2) = 'processando', 'segunda começa depois');
-- Execução travada há mais de 10 minutos não segura a fila.
UPDATE public.ia_tarefas SET iniciada_em = now() - interval '11 minutes' WHERE id = (SELECT id FROM t2);
SELECT pg_temp.msg(3, 1, 'Alô?');
UPDATE public.ia_tarefas SET executar_apos = now() - interval '1 second' WHERE id = pg_temp.pendente(1, 'responder');
SELECT pg_temp.ok((SELECT (public.ia_reservar_tarefa(pg_temp.pendente(1, 'responder'))).situacao) = 'processando',
  'travada há mais de 10 min não bloqueia');

-- 2. Cliente antigo = serviço realizado. Cadastro, orçamento e OS ainda não realizada não contam.
SELECT pg_temp.msg(10, 2, 'Oi');
UPDATE public.ia_tarefas SET situacao = 'concluida' WHERE conversa_id = (pg_temp.conversa(2)).id;
INSERT INTO public.customers (id, empresa_id, full_name, phone)
VALUES ('c3300000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pessoa Teste 2', '(11) 98000-0002');
UPDATE public.whatsapp_contacts SET current_customer_id = 'c3300000-0000-0000-0000-000000000001', is_existing_customer = true
 WHERE id = (pg_temp.conversa(2)).whatsapp_contact_id;
INSERT INTO public.quotes (empresa_id, cliente_nome, crm_lead_id, subtotal, desconto, total)
VALUES ('11111111-1111-1111-1111-111111111111', 'Pessoa Teste 2', (pg_temp.conversa(2)).crm_lead_id, 300, 0, 300);
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date)
VALUES ('e3300000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '33001',
        'c3300000-0000-0000-0000-000000000001', 300, current_date);
UPDATE public.crm_leads SET customer_id = 'c3300000-0000-0000-0000-000000000001',
       linked_work_order_id = 'e3300000-0000-0000-0000-000000000001'
 WHERE id = (pg_temp.conversa(2)).crm_lead_id;
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status)
VALUES ('f3300000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'e3300000-0000-0000-0000-000000000001', current_date + 3, '09:00', 'Agendado');
SELECT pg_temp.msg(11, 2, 'Posso mudar o horário?');
SELECT pg_temp.ok(pg_temp.tarefas(2) = 'responder:concluida,responder:pendente',
  'cadastro + orçamento + OS agendada: a Alice responde: ' || pg_temp.tarefas(2));
SELECT pg_temp.ok(NOT private.ia_cliente_antigo((pg_temp.conversa(2)).whatsapp_contact_id, now()),
  'OS não realizada não torna antiga');

-- Atendimento concluído: vira cliente antiga (só a partir da data em que foi realizado).
UPDATE public.ia_tarefas SET situacao = 'concluida' WHERE conversa_id = (pg_temp.conversa(2)).id;
UPDATE public.visits SET status = 'Concluído', completion_date = current_date - 5, completion_time = '11:00'
 WHERE id = 'f3300000-0000-0000-0000-000000000001';
SELECT pg_temp.ok(NOT private.ia_cliente_antigo((pg_temp.conversa(2)).whatsapp_contact_id, now() - interval '10 days'),
  'serviço realizado depois do momento consultado não conta');
SELECT pg_temp.ok(private.ia_cliente_antigo((pg_temp.conversa(2)).whatsapp_contact_id, now()), 'serviço realizado: antiga');
SELECT pg_temp.msg(12, 2, 'Oi de novo');
SELECT pg_temp.ok(pg_temp.tarefas(2) LIKE '%passar_para_humano:pendente%' AND pg_temp.tarefas(2) NOT LIKE '%responder:pendente%',
  'serviço realizado: fica com a equipe: ' || pg_temp.tarefas(2));
SELECT pg_temp.ok((SELECT dados->>'nota' FROM public.ia_tarefas WHERE id = pg_temp.pendente(2, 'passar_para_humano'))
  LIKE '%serviço realizado%', 'nota explica a regra');

-- Comprador da base importada (atendido antes do sistema) também é antigo.
SELECT pg_temp.msg(20, 3, 'Oi');
INSERT INTO public.mkt_contatos (empresa_id, nome, normalized_phone, tipo, ultimo_servico_em)
VALUES ('11111111-1111-1111-1111-111111111111', 'Pessoa Teste 3', '5511980000003', 'comprador', now() - interval '1 year')
ON CONFLICT (empresa_id, private.telefone_chave(normalized_phone))
DO UPDATE SET tipo = 'comprador', ultimo_servico_em = EXCLUDED.ultimo_servico_em;
SELECT pg_temp.ok(private.ia_cliente_antigo((pg_temp.conversa(3)).whatsapp_contact_id, now()), 'comprador importado: antigo');
-- Não comprador (só pediu orçamento antes) não.
SELECT pg_temp.msg(30, 4, 'Oi');
INSERT INTO public.mkt_contatos (empresa_id, nome, normalized_phone, tipo)
VALUES ('11111111-1111-1111-1111-111111111111', 'Pessoa Teste 4', '5511980000004', 'nao_comprador')
ON CONFLICT (empresa_id, private.telefone_chave(normalized_phone)) DO UPDATE SET tipo = 'nao_comprador';
SELECT pg_temp.ok(NOT private.ia_cliente_antigo((pg_temp.conversa(4)).whatsapp_contact_id, now()), 'não comprador: novo');

-- 3. Um follow-up pendente por conversa (equipe ou Alice).
CREATE TEMP TABLE lead5 AS SELECT (pg_temp.conversa(4)).crm_lead_id AS id, (pg_temp.conversa(4)).id AS conversa;
-- Manual (CRM) e antigo da Alice sem conversa já existentes.
INSERT INTO public.crm_followups (empresa_id, crm_lead_id, scheduled_at, responsavel, notes) VALUES
  ('11111111-1111-1111-1111-111111111111', (SELECT id FROM lead5), now() + interval '2 days', 'equipe', 'Ligar para a cliente'),
  ('11111111-1111-1111-1111-111111111111', (SELECT id FROM lead5), now() + interval '1 day', 'equipe', '🤖 Alice: toque fora da janela'),
  ('11111111-1111-1111-1111-111111111111', (SELECT id FROM lead5), now() + interval '1 day', 'equipe', '🤖 Alice: toque fora da janela');
-- Follow-up da Alice com tarefa.
INSERT INTO public.ia_tarefas (id, empresa_id, conversa_id, tipo, executar_apos)
VALUES ('a3300000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', (SELECT conversa FROM lead5),
        'followup', now() + interval '3 hours');
INSERT INTO public.crm_followups (empresa_id, crm_lead_id, conversa_id, scheduled_at, responsavel, ia_tarefa_id, notes)
VALUES ('11111111-1111-1111-1111-111111111111', (SELECT id FROM lead5), (SELECT conversa FROM lead5),
        now() + interval '3 hours', 'alice', 'a3300000-0000-0000-0000-000000000001', '🤖 Follow-up da Alice');
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_followups WHERE crm_lead_id = (SELECT id FROM lead5) AND status = 'Pendente') = 2,
  'antigos da Alice sem conversa cancelados; manual fica');
-- Novo da equipe na mesma conversa: cancela o da Alice e a tarefa dela.
INSERT INTO public.crm_followups (empresa_id, crm_lead_id, conversa_id, scheduled_at, responsavel, notes)
VALUES ('11111111-1111-1111-1111-111111111111', (SELECT id FROM lead5), (SELECT conversa FROM lead5),
        now() + interval '1 day', 'equipe', '🤖 Alice transferiu: desconto');
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_followups
                    WHERE conversa_id = (SELECT conversa FROM lead5) AND status = 'Pendente') = 1, 'um só por conversa');
SELECT pg_temp.ok((SELECT situacao FROM public.ia_tarefas WHERE id = 'a3300000-0000-0000-0000-000000000001') = 'ignorada',
  'tarefa do follow-up substituído cancelada');
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_followups
                    WHERE crm_lead_id = (SELECT id FROM lead5) AND status = 'Pendente' AND notes = 'Ligar para a cliente') = 1,
  'follow-up manual do CRM não é tocado');
SELECT pg_temp.ok((SELECT next_follow_up_at FROM public.crm_leads WHERE id = (SELECT id FROM lead5))
  = (SELECT min(scheduled_at) FROM public.crm_followups WHERE crm_lead_id = (SELECT id FROM lead5) AND status = 'Pendente'),
  'próximo follow-up do lead atualizado');

ROLLBACK;
