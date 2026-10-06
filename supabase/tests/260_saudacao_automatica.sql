-- Alice: saudação/ausência automática do WhatsApp Business do celular (eco da coexistência)
-- não tira a Alice; mensagem digitada (no celular ou no Chatwoot) continua tirando.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

-- _remetente: 'contact', 'user' (Chatwoot) ou 'eco' (app do celular: sem sender, external_echo).
-- _seg: segundos depois de 2026-10-05 12:00 (hora da mensagem).
CREATE FUNCTION pg_temp.msg(_id int, _conversa int, _tipo text, _texto text, _remetente text, _seg int)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.receber_evento_chatwoot('token-saud', 's' || _id, jsonb_build_object(
    'event', 'message_created', 'id', _id, 'message_type', _tipo, 'content', _texto,
    'private', false, 'created_at', to_char(timestamptz '2026-10-05 12:00:00Z' + make_interval(secs => _seg),
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'content_attributes', CASE WHEN _remetente = 'eco' THEN '{"external_echo": true}'::jsonb ELSE '{}'::jsonb END,
    'account', jsonb_build_object('id', 187967), 'inbox', jsonb_build_object('id', 13),
    'sender', CASE WHEN _remetente = 'eco' THEN NULL
                   ELSE jsonb_build_object('id', 900 + _conversa, 'type', _remetente) END,
    'conversation', jsonb_build_object('id', _conversa, 'inbox_id', 13, 'status', 'pending',
      'channel', 'Channel::Whatsapp', 'updated_at', 1790000000 + _id,
      'meta', jsonb_build_object('sender', jsonb_build_object('id', 500 + _conversa,
        'name', 'Cliente ' || _conversa, 'phone_number', '+55119800' || lpad(_conversa::text, 5, '0'))))));
$$;

CREATE FUNCTION pg_temp.tarefas(_conversa int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(t.tipo || ':' || t.situacao, ',' ORDER BY t.tipo, t.situacao), '-')
    FROM public.ia_tarefas t JOIN public.conversas c ON c.id = t.conversa_id
   WHERE c.chatwoot_conversation_id = _conversa;
$$;

INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('77777777-7777-7777-7777-777777777777', 'Nexa', 187967, 'token-saud');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('77777777-7777-7777-7777-777777777777', 13, '11111111-1111-1111-1111-111111111111');
INSERT INTO public.ia_configuracoes (empresa_id, ativo, espera_segundos)
VALUES ('11111111-1111-1111-1111-111111111111', true, 8)
ON CONFLICT (empresa_id) DO UPDATE SET ativo = true;

-- 1. Saudação 2 s depois da primeira mensagem do cliente: a Alice continua.
SELECT pg_temp.msg(101, 21, 'incoming', 'Oi, quero orçamento', 'contact', 100);
SELECT pg_temp.msg(102, 21, 'outgoing', 'Olá! Seja muito bem-vindo(a)!', 'eco', 102);
SELECT pg_temp.ok(pg_temp.tarefas(21) = 'responder:pendente', 'saudação: ' || pg_temp.tarefas(21));

-- 2. Saudação gravada antes da mensagem do cliente (ordem trocada): texto já visto, a Alice continua.
SELECT pg_temp.msg(201, 22, 'outgoing', 'Olá! Seja muito bem-vindo(a)!', 'eco', 200);
SELECT pg_temp.msg(202, 22, 'incoming', 'Boa tarde', 'contact', 201);
SELECT pg_temp.ok(pg_temp.tarefas(22) = 'responder:pendente', 'saudação antes do cliente: ' || pg_temp.tarefas(22));

-- 3. Ausência (texto novo) 4 s antes da primeira mensagem do cliente gravada: a Alice continua.
SELECT pg_temp.msg(301, 23, 'incoming', 'Olá?', 'contact', 300);
SELECT pg_temp.msg(302, 23, 'outgoing', 'No momento estamos fora do horário.', 'eco', 296);
SELECT pg_temp.ok(pg_temp.tarefas(23) = 'responder:pendente', 'ausência: ' || pg_temp.tarefas(23));

-- 4. Digitada no celular 40 s depois: atendente humano, a Alice sai.
SELECT pg_temp.msg(401, 24, 'incoming', 'Oi', 'contact', 400);
SELECT pg_temp.msg(402, 24, 'outgoing', 'Oii, aqui é a Carol!', 'eco', 440);
SELECT pg_temp.ok(pg_temp.tarefas(24) = 'passar_para_humano:pendente,responder:ignorada',
  'digitada no celular: ' || pg_temp.tarefas(24));

-- 5. Escrita no Chatwoot (remetente atendente), mesmo 3 s depois: a Alice sai.
SELECT pg_temp.msg(501, 25, 'incoming', 'Oi', 'contact', 500);
SELECT pg_temp.msg(502, 25, 'outgoing', 'Olá! Seja muito bem-vindo(a)!', 'user', 503);
SELECT pg_temp.ok(pg_temp.tarefas(25) = 'passar_para_humano:pendente,responder:ignorada',
  'escrita no Chatwoot: ' || pg_temp.tarefas(25));

-- 6. Conversa antiga: a mesma ausência de novo (já vista) não tira a Alice.
SELECT pg_temp.msg(601, 23, 'incoming', 'Ainda estão aí?', 'contact', 5000);
SELECT pg_temp.msg(602, 23, 'outgoing', 'No momento estamos fora do horário.', 'eco', 5002);
SELECT pg_temp.ok(pg_temp.tarefas(23) = 'responder:pendente', 'ausência repetida: ' || pg_temp.tarefas(23));

-- 7. Conversa antiga: texto novo digitado no celular logo depois do cliente tira a Alice
--    (não é a primeira mensagem do cliente).
SELECT pg_temp.msg(701, 21, 'incoming', 'Mandei a foto', 'contact', 9000);
SELECT pg_temp.msg(702, 21, 'outgoing', 'Recebi, já te passo o valor', 'eco', 9003);
SELECT pg_temp.ok(pg_temp.tarefas(21) = 'passar_para_humano:pendente,responder:ignorada',
  'resposta rápida digitada: ' || pg_temp.tarefas(21));

ROLLBACK;
