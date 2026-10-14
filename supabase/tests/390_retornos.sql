-- Retornos da equipe fecham sozinhos (mensagem digitada pela equipe, lead com OS ou encerrado),
-- vencidos há mais de 3 dias expiram, e o gatilho nunca impede a gravação da mensagem. Fictício.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

-- Quatro leads, cada um com o seu contato; o lead C também tem conversa (para a Alice).
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, display_phone, profile_name) VALUES
  ('a3900000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '5511970000391', '11970000391', 'Lead A'),
  ('a3900000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '5511970000392', '11970000392', 'Lead B'),
  ('a3900000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '5511970000393', '11970000393', 'Lead C'),
  ('a3900000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '5511970000394', '11970000394', 'Lead D');
INSERT INTO public.crm_leads (id, empresa_id, whatsapp_contact_id, lead_name, phone, normalized_phone, is_open) VALUES
  ('b3900000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a3900000-0000-0000-0000-000000000001', 'Lead A', '11970000391', '5511970000391', true),
  ('b3900000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a3900000-0000-0000-0000-000000000002', 'Lead B', '11970000392', '5511970000392', true),
  ('b3900000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a3900000-0000-0000-0000-000000000003', 'Lead C', '11970000393', '5511970000393', true),
  ('b3900000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a3900000-0000-0000-0000-000000000004', 'Lead D', '11970000394', '5511970000394', true);
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('c3900000-0000-0000-0000-000000000001', 'Teste 390', 390, 'token-390');
INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id, whatsapp_contact_id, crm_lead_id, status)
VALUES ('d3900000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c3900000-0000-0000-0000-000000000001', 390003,
        'a3900000-0000-0000-0000-000000000003', 'b3900000-0000-0000-0000-000000000003', 'pending');

-- Como o app agenda (scheduleFollowup): cria o retorno e marca o próximo no lead.
CREATE FUNCTION pg_temp.retorno(_lead uuid, _quando timestamptz) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE novo uuid;
BEGIN
  INSERT INTO public.crm_followups (empresa_id, crm_lead_id, scheduled_at, responsavel, notes)
  VALUES ('11111111-1111-1111-1111-111111111111', _lead, _quando, 'equipe', 'Ligar de volta')
  RETURNING id INTO novo;
  UPDATE public.crm_leads l
     SET next_follow_up_at = (SELECT min(scheduled_at) FROM public.crm_followups WHERE crm_lead_id = l.id AND status = 'Pendente')
   WHERE l.id = _lead;
  RETURN novo;
END $$;
CREATE FUNCTION pg_temp.msg(_contato uuid, _lead uuid, _direcao text, _remetente text, _privada boolean) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, crm_lead_id, direction, remetente_tipo, privada, text_content, origem)
  VALUES ('11111111-1111-1111-1111-111111111111', _contato, _lead, _direcao, _remetente, _privada, 'mensagem de teste', 'chatwoot')
  RETURNING id;
$$;
CREATE FUNCTION pg_temp.situacao(_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT status || ' / ' || coalesce(result, '-') FROM public.crm_followups WHERE id = _id;
$$;

-- ---------------------------------------------------------------- 1. só mensagem digitada pela equipe conta
SELECT set_config('teste.ra', pg_temp.retorno('b3900000-0000-0000-0000-000000000001', now() + interval '1 day')::text, false);
-- Alice (robô), inclusive campanha/confirmação/pós-venda/tc_lead_site, que saem pelo token do robô.
SELECT pg_temp.msg('a3900000-0000-0000-0000-000000000001', 'b3900000-0000-0000-0000-000000000001', 'Enviada', 'agent_bot', false);
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.ra')::uuid) = 'Pendente / -', 'mensagem da Alice/robô não fecha');
-- Nota privada da equipe.
SELECT pg_temp.msg('a3900000-0000-0000-0000-000000000001', 'b3900000-0000-0000-0000-000000000001', 'Enviada', 'user', true);
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.ra')::uuid) = 'Pendente / -', 'nota privada não fecha');
-- Cliente escreveu.
SELECT pg_temp.msg('a3900000-0000-0000-0000-000000000001', 'b3900000-0000-0000-0000-000000000001', 'Recebida', 'contact', false);
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.ra')::uuid) = 'Pendente / -', 'mensagem do cliente não fecha');
-- Mensagem de pessoa da equipe sem lead ligado: nada acontece.
SELECT pg_temp.msg('a3900000-0000-0000-0000-000000000001', NULL, 'Enviada', 'user', false);
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.ra')::uuid) = 'Pendente / -', 'mensagem sem lead não fecha');
SELECT pg_temp.ok((SELECT next_follow_up_at IS NOT NULL FROM public.crm_leads WHERE id = 'b3900000-0000-0000-0000-000000000001'),
  'lead continua com o próximo retorno marcado');
-- Pessoa da equipe escreveu na conversa do lead: fecha.
SELECT pg_temp.msg('a3900000-0000-0000-0000-000000000001', 'b3900000-0000-0000-0000-000000000001', 'Enviada', 'user', false);
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.ra')::uuid) = 'Concluída / Equipe respondeu na conversa',
  'mensagem digitada pela equipe fecha o retorno');
SELECT pg_temp.ok((SELECT next_follow_up_at IS NULL FROM public.crm_leads WHERE id = 'b3900000-0000-0000-0000-000000000001'),
  'próximo retorno do lead recalculado');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_messages WHERE crm_lead_id = 'b3900000-0000-0000-0000-000000000001') = 4,
  'as mensagens foram gravadas');

-- ---------------------------------------------------------------- 2. à prova de falha
SELECT set_config('teste.rf', pg_temp.retorno('b3900000-0000-0000-0000-000000000001', now() + interval '1 day')::text, false);
SELECT set_config('nexa.teste_falha_retornos', '1', false);
SELECT set_config('teste.msg', pg_temp.msg('a3900000-0000-0000-0000-000000000001', 'b3900000-0000-0000-0000-000000000001', 'Enviada', 'user', false)::text, false);
SELECT set_config('nexa.teste_falha_retornos', '', false);
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_messages WHERE id = current_setting('teste.msg')::uuid) = 1,
  'a mensagem é gravada mesmo com o gatilho falhando');
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.rf')::uuid) = 'Pendente / -', 'com a falha, o retorno fica como estava');
SELECT pg_temp.ok((SELECT count(*) FROM public.gatilho_erros
                    WHERE gatilho = 'crm_retornos_por_mensagem' AND erro LIKE '%falha simulada%'
                      AND detalhe->>'mensagem_id' = current_setting('teste.msg')) = 1,
  'a falha fica registrada em gatilho_erros');
-- Sem a falha, a próxima mensagem da equipe fecha normalmente.
SELECT pg_temp.msg('a3900000-0000-0000-0000-000000000001', 'b3900000-0000-0000-0000-000000000001', 'Enviada', 'user', false);
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.rf')::uuid) = 'Concluída / Equipe respondeu na conversa', 'volta ao normal');

-- ---------------------------------------------------------------- 3. lead encerrado
SELECT set_config('teste.rb', pg_temp.retorno('b3900000-0000-0000-0000-000000000002', now() + interval '2 days')::text, false);
UPDATE public.crm_leads SET is_open = false, closed_at = now() WHERE id = 'b3900000-0000-0000-0000-000000000002';
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.rb')::uuid) = 'Concluída / Lead encerrado', 'lead encerrado fecha o retorno');

-- ---------------------------------------------------------------- 4. lead virou OS (equipe conclui, Alice cancela com a tarefa)
SELECT set_config('teste.rc', pg_temp.retorno('b3900000-0000-0000-0000-000000000003', now() + interval '2 days')::text, false);
INSERT INTO public.ia_tarefas (id, empresa_id, conversa_id, tipo, executar_apos)
VALUES ('e3900000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd3900000-0000-0000-0000-000000000003', 'followup', now() + interval '3 hours');
INSERT INTO public.crm_followups (id, empresa_id, crm_lead_id, conversa_id, scheduled_at, responsavel, ia_tarefa_id, notes)
VALUES ('f3900000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b3900000-0000-0000-0000-000000000003',
        'd3900000-0000-0000-0000-000000000003', now() + interval '3 hours', 'alice', 'e3900000-0000-0000-0000-000000000001', '🤖 Follow-up da Alice');
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.rc')::uuid) = 'Pendente / -', 'retorno da equipe segue com o da Alice');
INSERT INTO public.customers (id, empresa_id, full_name, phone)
VALUES ('c3900000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Lead C', '11970000393');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value)
VALUES ('e3900000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '39001', 'c3900000-0000-0000-0000-000000000009', 100);
UPDATE public.crm_leads SET linked_work_order_id = 'e3900000-0000-0000-0000-000000000009' WHERE id = 'b3900000-0000-0000-0000-000000000003';
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.rc')::uuid) = 'Concluída / Lead virou OS', 'lead com OS fecha o retorno da equipe');
SELECT pg_temp.ok(pg_temp.situacao('f3900000-0000-0000-0000-000000000001') = 'Cancelada / Lead virou OS', 'o da Alice é cancelado');
SELECT pg_temp.ok((SELECT situacao FROM public.ia_tarefas WHERE id = 'e3900000-0000-0000-0000-000000000001') = 'ignorada', 'tarefa da Alice ignorada');
SELECT pg_temp.ok((SELECT next_follow_up_at IS NULL FROM public.crm_leads WHERE id = 'b3900000-0000-0000-0000-000000000003'), 'lead sem próximo retorno');

-- ---------------------------------------------------------------- 5. vencidos há mais de 3 dias expiram
SELECT set_config('teste.rd1', pg_temp.retorno('b3900000-0000-0000-0000-000000000004', now() - interval '4 days')::text, false);
SELECT set_config('teste.rd2', pg_temp.retorno('b3900000-0000-0000-0000-000000000004', now() - interval '2 days')::text, false);
INSERT INTO public.crm_followups (id, empresa_id, crm_lead_id, scheduled_at, responsavel, notes)
VALUES ('f3900000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'b3900000-0000-0000-0000-000000000004',
        now() - interval '10 days', 'alice', '🤖 antigo da Alice');
SELECT pg_temp.ok(public.crm_expirar_retornos() = 1, 'só o vencido há mais de 3 dias expira');
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.rd1')::uuid) = 'Vencida / Sem resposta há mais de 3 dias', 'vencido há 4 dias expirou');
SELECT pg_temp.ok(pg_temp.situacao(current_setting('teste.rd2')::uuid) = 'Pendente / -', 'vencido há 2 dias continua na lista');
SELECT pg_temp.ok(pg_temp.situacao('f3900000-0000-0000-0000-000000000002') = 'Pendente / -', 'o da Alice não é tocado');
-- O próximo retorno do lead passa a ser o mais antigo ainda pendente (o da Alice, de 10 dias).
SELECT pg_temp.ok((SELECT next_follow_up_at = (SELECT scheduled_at FROM public.crm_followups WHERE id = 'f3900000-0000-0000-0000-000000000002')
                     FROM public.crm_leads WHERE id = 'b3900000-0000-0000-0000-000000000004'),
  'próximo retorno do lead recalculado depois da expiração');
SELECT pg_temp.ok(public.crm_expirar_retornos() = 0, 'rodar de novo não expira nada');
-- Só o robô chama.
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.crm_expirar_retornos()', 'EXECUTE'), 'tela não chama');

ROLLBACK;
