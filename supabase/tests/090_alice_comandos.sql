-- Alice: comandos da equipe (#parar, #desligar, #alice), mensagem do WhatsApp do celular (eco)
-- tirando a Alice da conversa e cliente antigo indo direto para a equipe.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

-- _remetente: 'contact', 'user', 'agent_bot' ou 'eco' (mensagem digitada no celular: sem sender).
CREATE FUNCTION pg_temp.msg(_id int, _conversa int, _tipo text, _texto text,
  _remetente text DEFAULT 'contact', _privada boolean DEFAULT false, _situacao text DEFAULT 'pending')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.receber_evento_chatwoot('token-cmd', 'c' || _id, jsonb_build_object(
    'event', 'message_created', 'id', _id, 'message_type', _tipo, 'content', _texto,
    'private', _privada, 'created_at', to_char(timestamptz '2026-09-28 12:00:00Z' + make_interval(secs => _id),
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'content_attributes', CASE WHEN _remetente = 'eco' THEN '{"external_echo": true}'::jsonb ELSE '{}'::jsonb END,
    'account', jsonb_build_object('id', 187966), 'inbox', jsonb_build_object('id', 12),
    'sender', CASE WHEN _remetente = 'eco' THEN NULL
                   ELSE jsonb_build_object('id', 900 + _conversa, 'type', _remetente) END,
    'conversation', jsonb_build_object('id', _conversa, 'inbox_id', 12, 'status', _situacao,
      'channel', 'Channel::Whatsapp', 'updated_at', 1790000000 + _id,
      'meta', jsonb_build_object('sender', jsonb_build_object('id', 500 + _conversa,
        'name', 'Cliente ' || _conversa, 'phone_number', '+55119700' || lpad(_conversa::text, 5, '0'))))));
$$;

CREATE FUNCTION pg_temp.tarefas(_conversa int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(t.tipo || ':' || t.situacao, ',' ORDER BY t.tipo, t.situacao), '-')
    FROM public.ia_tarefas t JOIN public.conversas c ON c.id = t.conversa_id
   WHERE c.chatwoot_conversation_id = _conversa;
$$;

CREATE FUNCTION pg_temp.nota(_conversa int) RETURNS text LANGUAGE sql AS $$
  SELECT t.dados->>'nota' FROM public.ia_tarefas t JOIN public.conversas c ON c.id = t.conversa_id
   WHERE c.chatwoot_conversation_id = _conversa AND t.tipo = 'passar_para_humano' AND t.situacao = 'pendente';
$$;

CREATE FUNCTION pg_temp.contato(_conversa int) RETURNS public.whatsapp_contacts LANGUAGE sql AS $$
  SELECT ct.* FROM public.whatsapp_contacts ct JOIN public.conversas c ON c.whatsapp_contact_id = ct.id
   WHERE c.chatwoot_conversation_id = _conversa;
$$;

INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('66666666-6666-6666-6666-666666666666', 'Nexa', 187966, 'token-cmd');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('66666666-6666-6666-6666-666666666666', 12, '11111111-1111-1111-1111-111111111111');
INSERT INTO public.ia_configuracoes (empresa_id, ativo, espera_segundos)
VALUES ('11111111-1111-1111-1111-111111111111', true, 8);

-- 0. Reconhecimento dos comandos.
SELECT pg_temp.ok(private.ia_comando_da_equipe('#parar') = 'parar', '#parar');
SELECT pg_temp.ok(private.ia_comando_da_equipe('  /PARAR  ') = 'parar', '/PARAR com espaços');
SELECT pg_temp.ok(private.ia_comando_da_equipe('#humano cliente antigo') = 'parar', '#humano com texto depois');
SELECT pg_temp.ok(private.ia_comando_da_equipe('#desligar') = 'desligar', '#desligar');
SELECT pg_temp.ok(private.ia_comando_da_equipe('/alice') = 'alice', '/alice');
SELECT pg_temp.ok(private.ia_comando_da_equipe('#pararam') IS NULL, 'palavra parecida não é comando');
SELECT pg_temp.ok(private.ia_comando_da_equipe('vou parar aqui') IS NULL, 'texto normal não é comando');
SELECT pg_temp.ok(private.ia_comando_da_equipe(NULL) IS NULL, 'sem texto');

-- 1. Nota privada #parar: a Alice sai (cancela a resposta pendente e passa para a equipe com nota).
SELECT pg_temp.msg(1, 1, 'incoming', 'Oi, quero orçamento');
SELECT pg_temp.ok(pg_temp.tarefas(1) = 'responder:pendente', 'cliente escreveu: ' || pg_temp.tarefas(1));
SELECT pg_temp.msg(2, 1, 'outgoing', '#parar', 'user', true);
SELECT pg_temp.ok(pg_temp.tarefas(1) = 'passar_para_humano:pendente,responder:ignorada',
  '#parar: ' || pg_temp.tarefas(1));
SELECT pg_temp.ok(pg_temp.nota(1) LIKE '%A Alice saiu desta conversa%', 'nota de confirmação');

-- 2. Nota privada comum (sem comando) não mexe em nada.
SELECT pg_temp.msg(3, 2, 'incoming', 'Oi');
SELECT pg_temp.msg(4, 2, 'outgoing', 'Cliente parece antigo, vou ver', 'user', true);
SELECT pg_temp.ok(pg_temp.tarefas(2) = 'responder:pendente', 'nota comum: ' || pg_temp.tarefas(2));

-- 3. Nota do próprio robô com texto de comando não conta.
SELECT pg_temp.msg(5, 2, 'outgoing', '#parar', 'agent_bot', true);
SELECT pg_temp.ok(pg_temp.tarefas(2) = 'responder:pendente', 'nota do robô: ' || pg_temp.tarefas(2));

-- 4. Mensagem digitada no WhatsApp do celular (eco, sem sender) 37 s depois: a Alice sai.
SELECT pg_temp.msg(40, 2, 'outgoing', 'Oii, aqui é a Maria!', 'eco');
SELECT pg_temp.ok(pg_temp.tarefas(2) = 'passar_para_humano:pendente,responder:ignorada',
  'eco do celular: ' || pg_temp.tarefas(2));
SELECT pg_temp.ok(pg_temp.nota(2) IS NULL, 'eco do celular não gera nota');
SELECT pg_temp.ok((SELECT remetente_tipo FROM public.whatsapp_messages WHERE text_content = 'Oii, aqui é a Maria!') = 'user',
  'eco gravado como atendente');

-- 5. #desligar: IA desligada no cliente + passagem para a equipe.
SELECT pg_temp.msg(7, 3, 'incoming', 'Oi');
SELECT pg_temp.msg(8, 3, 'outgoing', '/desligar', 'user', true);
SELECT pg_temp.ok((pg_temp.contato(3)).ia_desligada, '#desligar marca o cliente');
SELECT pg_temp.ok(pg_temp.tarefas(3) = 'passar_para_humano:pendente,responder:ignorada',
  '#desligar: ' || pg_temp.tarefas(3));
SELECT pg_temp.ok(pg_temp.nota(3) LIKE '%IA desligada para este cliente%', 'nota do #desligar');

-- 6. #alice: religa o cliente, cancela a passagem pendente e agenda a devolução.
SELECT pg_temp.msg(9, 3, 'outgoing', '#alice', 'user', true, 'open');
SELECT pg_temp.ok(NOT (pg_temp.contato(3)).ia_desligada, '#alice religa a IA do cliente');
SELECT pg_temp.ok(pg_temp.tarefas(3) = 'devolver_para_alice:pendente,passar_para_humano:ignorada,responder:ignorada',
  '#alice: ' || pg_temp.tarefas(3));
SELECT pg_temp.ok((SELECT devolvida_para_alice_em IS NOT NULL FROM public.conversas WHERE chatwoot_conversation_id = 3),
  'conversa marcada como devolvida');
-- Depois do #alice, #parar cancela a devolução pendente.
SELECT pg_temp.msg(10, 3, 'outgoing', '#parar', 'user', true, 'open');
SELECT pg_temp.ok(pg_temp.tarefas(3) = 'devolver_para_alice:ignorada,passar_para_humano:ignorada,passar_para_humano:pendente,responder:ignorada',
  '#parar depois do #alice: ' || pg_temp.tarefas(3));

-- 7. Comando vale com a Alice desligada na empresa (a equipe recebe a confirmação).
UPDATE public.ia_configuracoes SET ativo = false;
SELECT pg_temp.msg(11, 4, 'incoming', 'Oi');
SELECT pg_temp.msg(12, 4, 'outgoing', '#desligar', 'user', true, 'open');
SELECT pg_temp.ok((pg_temp.contato(4)).ia_desligada, 'desligar com a Alice desligada');
UPDATE public.ia_configuracoes SET ativo = true;

-- 8. Cliente antigo (cadastrado em Clientes): a Alice não responde; passa para a equipe com nota.
INSERT INTO public.customers (empresa_id, full_name, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Karina', '(11) 97000-0005');
SELECT pg_temp.msg(13, 5, 'incoming', 'Oi! Quero marcar de novo');
SELECT pg_temp.ok((pg_temp.contato(5)).is_existing_customer, 'contato ligado ao cliente');
SELECT pg_temp.ok(pg_temp.tarefas(5) = 'passar_para_humano:pendente', 'cliente antigo: ' || pg_temp.tarefas(5));
SELECT pg_temp.ok(pg_temp.nota(5) LIKE '%Cliente antigo%', 'nota do cliente antigo');

-- 9. Devolvida pela equipe (#alice), a Alice atende o cliente antigo.
UPDATE public.ia_tarefas SET situacao = 'concluida' WHERE situacao = 'pendente';
SELECT pg_temp.msg(14, 5, 'outgoing', '#alice', 'user', true, 'open');
UPDATE public.ia_tarefas SET situacao = 'concluida' WHERE situacao = 'pendente';
UPDATE public.conversas SET status = 'pending' WHERE chatwoot_conversation_id = 5;
SELECT pg_temp.msg(15, 5, 'incoming', 'Pode ser sábado?');
SELECT pg_temp.ok(pg_temp.tarefas(5) LIKE '%responder:pendente%', 'devolvida: Alice responde: ' || pg_temp.tarefas(5));

-- 10. Lead com serviço feito também é cliente antigo; com a opção desligada a Alice responde.
SELECT pg_temp.msg(16, 6, 'incoming', 'Oi');
UPDATE public.ia_tarefas SET situacao = 'concluida' WHERE situacao = 'pendente';
UPDATE public.crm_leads SET realizado_em = now()
 WHERE id = (SELECT crm_lead_id FROM public.conversas WHERE chatwoot_conversation_id = 6);
SELECT pg_temp.msg(17, 6, 'incoming', 'Oi de novo');
SELECT pg_temp.ok(pg_temp.tarefas(6) = 'passar_para_humano:pendente,responder:concluida',
  'serviço feito: ' || pg_temp.tarefas(6));
UPDATE public.ia_tarefas SET situacao = 'concluida' WHERE situacao = 'pendente';
UPDATE public.ia_configuracoes SET clientes_antigos_com_equipe = false;
SELECT pg_temp.msg(18, 6, 'incoming', 'Alô?');
SELECT pg_temp.ok(pg_temp.tarefas(6) LIKE '%responder:pendente%', 'opção desligada: ' || pg_temp.tarefas(6));

ROLLBACK;
