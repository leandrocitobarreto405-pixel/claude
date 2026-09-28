-- Testes da fila da Alice: agenda respostas só onde deve, junta mensagens seguidas, sai quando um
-- humano entra na conversa, e isola as empresas.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

-- Mensagem no formato do webhook (conversa com a situação informada).
CREATE FUNCTION pg_temp.msg(_id int, _conversa int, _inbox int, _tipo text, _texto text,
  _situacao text DEFAULT 'pending', _remetente text DEFAULT 'contact', _privada boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.receber_evento_chatwoot('token-alice', 'd' || _id, jsonb_build_object(
    'event', 'message_created', 'id', _id, 'message_type', _tipo, 'content', _texto,
    'private', _privada, 'created_at', '2026-09-28T12:00:00Z',
    'account', jsonb_build_object('id', 187966), 'inbox', jsonb_build_object('id', _inbox),
    'sender', jsonb_build_object('id', 900 + _conversa, 'type', _remetente),
    'conversation', jsonb_build_object('id', _conversa, 'inbox_id', _inbox, 'status', _situacao,
      'channel', 'Channel::Whatsapp', 'updated_at', 1790000000 + _id,
      'meta', jsonb_build_object('sender', jsonb_build_object('id', 500 + _conversa,
        'name', 'Cliente ' || _conversa, 'phone_number', '+55119700' || lpad(_conversa::text, 5, '0'))))));
$$;

CREATE FUNCTION pg_temp.tarefas(_conversa int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(t.tipo || ':' || t.situacao, ',' ORDER BY t.created_at, t.tipo), '-')
    FROM public.ia_tarefas t JOIN public.conversas c ON c.id = t.conversa_id
   WHERE c.chatwoot_conversation_id = _conversa;
$$;

INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Cliente B');
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('33333333-3333-3333-3333-333333333333', 'Nexa', 187966, 'token-alice');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('33333333-3333-3333-3333-333333333333', 12, '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', 34, '22222222-2222-2222-2222-222222222222');

-- 1. Alice desligada: nada é agendado.
SELECT pg_temp.msg(1, 1, 12, 'incoming', 'Oi');
SELECT pg_temp.ok(pg_temp.tarefas(1) = '-', 'Alice desligada não agenda');

INSERT INTO public.ia_configuracoes (empresa_id, ativo, espera_segundos)
VALUES ('11111111-1111-1111-1111-111111111111', true, 8);

-- 2. Conversa aberta (humano): nada é agendado.
SELECT pg_temp.msg(2, 2, 12, 'incoming', 'Oi', 'open');
SELECT pg_temp.ok(pg_temp.tarefas(2) = '-', 'conversa aberta não agenda');

-- 3. Conversa pendente: uma tarefa, com espera; mensagens seguidas adiam a mesma tarefa.
SELECT pg_temp.msg(3, 3, 12, 'incoming', 'Oi');
SELECT pg_temp.ok(pg_temp.tarefas(3) = 'responder:pendente', 'mensagem do cliente agenda resposta');
SELECT pg_temp.ok((SELECT executar_apos > now() + interval '7 seconds' FROM public.ia_tarefas t
  JOIN public.conversas c ON c.id = t.conversa_id WHERE c.chatwoot_conversation_id = 3), 'espera configurada');
UPDATE public.ia_tarefas SET enfileirada = true;
SELECT pg_temp.msg(4, 3, 12, 'incoming', 'quero um orçamento');
SELECT pg_temp.ok(pg_temp.tarefas(3) = 'responder:pendente', 'mensagens seguidas: uma tarefa só');
SELECT pg_temp.ok((SELECT NOT enfileirada FROM public.ia_tarefas t JOIN public.conversas c ON c.id = t.conversa_id
  WHERE c.chatwoot_conversation_id = 3), 'tarefa adiada volta para a fila');

-- 4. Nota privada e resposta do próprio robô não mexem na fila.
SELECT pg_temp.msg(5, 3, 12, 'outgoing', 'nota interna', 'pending', 'user', true);
SELECT pg_temp.msg(6, 3, 12, 'outgoing', 'Olá! Sou a Alice', 'pending', 'agent_bot');
SELECT pg_temp.ok(pg_temp.tarefas(3) = 'responder:pendente', 'nota privada e robô não cancelam');

-- 5. Atendente humano escreve: a resposta agendada é cancelada e a conversa vai para humano.
SELECT pg_temp.msg(7, 3, 12, 'outgoing', 'Oi, aqui é a Carol', 'pending', 'user');
SELECT pg_temp.ok(pg_temp.tarefas(3) = 'passar_para_humano:pendente,responder:ignorada',
  'humano assumiu: ' || pg_temp.tarefas(3));

-- 6. Conversa que sai de "pendente" no Chatwoot cancela a resposta agendada.
SELECT pg_temp.msg(8, 8, 12, 'incoming', 'Oi');
SELECT public.receber_evento_chatwoot('token-alice', 'st8', jsonb_build_object(
  'event', 'conversation_status_changed', 'id', 8, 'inbox_id', 12, 'status', 'open',
  'account', jsonb_build_object('id', 187966), 'updated_at', 1790009999,
  'meta', jsonb_build_object('sender', jsonb_build_object('id', 508, 'phone_number', '+551197000008'))));
SELECT pg_temp.ok(pg_temp.tarefas(8) = 'responder:ignorada', 'conversa aberta no Chatwoot cancela: ' || pg_temp.tarefas(8));

-- 7. Outra empresa sem Alice: nada é agendado.
SELECT pg_temp.msg(9, 9, 34, 'incoming', 'Oi');
SELECT pg_temp.ok(pg_temp.tarefas(9) = '-', 'empresa sem Alice');

-- 8. Reserva: só quando chega a hora, e uma vez.
CREATE TEMP TABLE t10 AS SELECT t.id FROM public.ia_tarefas t JOIN public.conversas c ON c.id = t.conversa_id
  WHERE c.chatwoot_conversation_id = 3 AND t.tipo = 'passar_para_humano';
SELECT pg_temp.msg(10, 10, 12, 'incoming', 'Oi');
CREATE TEMP TABLE t11 AS SELECT t.id FROM public.ia_tarefas t JOIN public.conversas c ON c.id = t.conversa_id
  WHERE c.chatwoot_conversation_id = 10;
SELECT pg_temp.ok((SELECT (public.ia_reservar_tarefa(id)).id FROM t11) IS NULL, 'antes da hora não reserva');
UPDATE public.ia_tarefas SET executar_apos = now() - interval '1 second' WHERE id = (SELECT id FROM t11);
SELECT pg_temp.ok((SELECT (public.ia_reservar_tarefa(id)).situacao FROM t11) = 'processando', 'reserva na hora');
SELECT pg_temp.ok((SELECT (public.ia_reservar_tarefa(id)).id FROM t11) IS NULL, 'não reserva duas vezes');
SELECT pg_temp.ok((SELECT (public.ia_reservar_tarefa(id)).tipo FROM t10) = 'passar_para_humano', 'passar para humano é imediato');

-- 9. Acesso: empresa vê só a sua fila; só admin altera a configuração.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin@a.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'atendente@a.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'admin@b.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'atendente'),
  ('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'admin');
INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo)
SELECT '22222222-2222-2222-2222-222222222222', id, 'responder' FROM public.conversas WHERE chatwoot_conversation_id = 9;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.ia_tarefas WHERE empresa_id <> '11111111-1111-1111-1111-111111111111') = 0,
  'empresa só vê a própria fila');
SELECT pg_temp.ok((SELECT count(*) FROM public.ia_configuracoes) = 1, 'vê a própria configuração');
UPDATE public.ia_configuracoes SET instrucoes = 'invasão';
SELECT pg_temp.ok((SELECT instrucoes FROM public.ia_configuracoes) = '', 'atendente não altera a configuração');
DO $$ BEGIN
  PERFORM public.ia_reservar_tarefa(gen_random_uuid());
  RAISE EXCEPTION 'FALHOU: usuário reservou tarefa';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.ia_tarefas SET situacao = 'concluida';
  RAISE EXCEPTION 'FALHOU: usuário alterou a fila';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.ia_configuracoes SET instrucoes = 'Sempre pedir foto do sofá.';
SELECT pg_temp.ok((SELECT instrucoes FROM public.ia_configuracoes) = 'Sempre pedir foto do sofá.', 'admin altera a configuração');
DO $$ BEGIN
  INSERT INTO public.ia_configuracoes (empresa_id, ativo) VALUES ('22222222-2222-2222-2222-222222222222', true);
  RAISE EXCEPTION 'FALHOU: criou configuração de outra empresa';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

-- 10. Segredo do robô: só o servidor lê.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM alice_bot_token FROM public.chatwoot_conexao_segredos;
  RAISE EXCEPTION 'FALHOU: usuário leu o token do robô';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

ROLLBACK;
