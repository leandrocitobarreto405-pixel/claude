-- Leads novos (o cliente chamou) × reativação (a empresa chamou): classificação pela primeira
-- mensagem, eventos fora de ordem, troca manual, origem e indicadores separados.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

CREATE FUNCTION pg_temp.msg(_id int, _conversa int, _tipo text, _texto text, _quando text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.receber_evento_chatwoot('token-entrada', 'e' || _id, jsonb_build_object(
    'event', 'message_created', 'id', _id, 'message_type', _tipo, 'content', _texto,
    'private', false, 'created_at', _quando,
    'account', jsonb_build_object('id', 187966), 'inbox', jsonb_build_object('id', 12),
    'sender', CASE WHEN _tipo = 'incoming'
                   THEN jsonb_build_object('id', 500 + _conversa, 'type', 'contact')
                   ELSE jsonb_build_object('id', 7, 'type', 'user') END,
    'conversation', jsonb_build_object('id', _conversa, 'inbox_id', 12, 'status', 'open',
      'channel', 'Channel::Whatsapp',
      'meta', jsonb_build_object('sender', jsonb_build_object('id', 500 + _conversa,
        'name', 'Cliente ' || _conversa, 'phone_number', '+55119600' || lpad(_conversa::text, 5, '0'))))));
$$;

CREATE FUNCTION pg_temp.lead(_conversa int) RETURNS public.crm_leads LANGUAGE sql AS $$
  SELECT l.* FROM public.crm_leads l JOIN public.conversas c ON c.crm_lead_id = l.id
   WHERE c.chatwoot_conversation_id = _conversa;
$$;

INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('55555555-5555-5555-5555-555555555555', 'Nexa', 187966, 'token-entrada');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('55555555-5555-5555-5555-555555555555', 12, '11111111-1111-1111-1111-111111111111');

-- 1. Cliente chamou primeiro: lead novo, com origem pela mensagem.
SELECT pg_temp.msg(1, 1, 'incoming', 'Olá! Vim pelo Google, quero orçamento', '2026-09-20T12:00:00Z');
SELECT pg_temp.msg(2, 1, 'outgoing', 'Oi! Tudo bem?', '2026-09-20T12:01:00Z');
SELECT pg_temp.ok((pg_temp.lead(1)).entrada = 'receptivo', 'cliente chamou: receptivo');
SELECT pg_temp.ok((pg_temp.lead(1)).respondeu_em = '2026-09-20T12:00:00Z', 'respondeu_em do cliente');
SELECT pg_temp.ok((SELECT o.name FROM public.config_options o WHERE o.id = (pg_temp.lead(1)).sales_origin_id) = 'Google',
  'origem identificada no lead novo');

-- 2. Empresa chamou primeiro (reativação): ativo; a resposta do cliente não vira origem.
SELECT pg_temp.msg(10, 2, 'template', 'Oi! Já faz 6 meses da sua higienização...', '2026-09-20T13:00:00Z');
SELECT pg_temp.ok((pg_temp.lead(2)).entrada = 'ativo', 'empresa chamou: ativo');
SELECT pg_temp.ok((pg_temp.lead(2)).respondeu_em IS NULL, 'ainda não respondeu');
SELECT pg_temp.msg(11, 2, 'incoming', 'Vim pelo Google e quero orçamento sim', '2026-09-20T13:30:00Z');
SELECT pg_temp.ok((pg_temp.lead(2)).entrada = 'ativo', 'continua ativo depois da resposta');
SELECT pg_temp.ok((pg_temp.lead(2)).respondeu_em = '2026-09-20T13:30:00Z', 'resposta registrada');
SELECT pg_temp.ok((pg_temp.lead(2)).sales_origin_id IS NULL, 'resposta de reativação não vira origem');

-- 3. Eventos fora de ordem: a mensagem do cliente (mais antiga) chega depois.
SELECT pg_temp.msg(21, 3, 'outgoing', 'Olá! Sou a Alice', '2026-09-20T14:05:00Z');
SELECT pg_temp.ok((pg_temp.lead(3)).entrada = 'ativo', 'só a resposta chegou: ativo por enquanto');
SELECT pg_temp.msg(20, 3, 'incoming', 'Oi, quero orçamento', '2026-09-20T14:00:00Z');
SELECT pg_temp.ok((pg_temp.lead(3)).entrada = 'receptivo', 'mensagem mais antiga do cliente corrige para receptivo');

-- 4. Troca manual prevalece.
UPDATE public.crm_leads SET entrada = 'receptivo', entrada_manual = true WHERE id = (pg_temp.lead(2)).id;
SELECT pg_temp.msg(9, 2, 'template', 'mensagem antiga reenviada', '2026-09-19T10:00:00Z');
SELECT pg_temp.ok((pg_temp.lead(2)).entrada = 'receptivo', 'entrada marcada à mão não muda');
UPDATE public.crm_leads SET entrada = 'ativo', entrada_manual = false WHERE id = (pg_temp.lead(2)).id;

-- 5. Mais reativações: uma sem resposta.
SELECT pg_temp.msg(30, 4, 'template', 'Oi! Já faz 1 ano da impermeabilização...', '2026-09-21T10:00:00Z');

-- 6. Indicadores separados.
CREATE TEMP TABLE r AS SELECT public.indicadores_funil('2026-09-01', '2026-09-30') AS v;
CREATE TEMP TABLE a AS SELECT public.indicadores_funil('2026-09-01', '2026-09-30', 'ativo') AS v;
CREATE TEMP TABLE t AS SELECT public.indicadores_funil('2026-09-01', '2026-09-30', 'todos') AS v;
SELECT pg_temp.ok((SELECT (v->'funil'->>'leads')::int FROM r) = 2, 'padrão: só leads novos (' || (SELECT v->'funil'->>'leads' FROM r) || ')');
SELECT pg_temp.ok((SELECT (v->'funil'->>'leads')::int FROM a) = 2, 'reativação: chamados');
SELECT pg_temp.ok((SELECT (v->'funil'->>'responderam')::int FROM a) = 1, 'reativação: responderam');
SELECT pg_temp.ok((SELECT (v->'funil'->>'leads')::int FROM t) = 4, 'todos');
SELECT pg_temp.ok((SELECT v->'entradas' FROM r) = '{"ativo": 2, "receptivo": 2}'::jsonb,
  'contagem por tipo: ' || (SELECT (v->'entradas')::text FROM r));
SELECT pg_temp.ok((SELECT v->'origens'->0->>'origem' FROM a) = 'Lead antigo', 'reativação agrupa por tipo, não por origem');
SELECT pg_temp.ok(NOT (SELECT v::text LIKE '%Lead antigo%' FROM r), 'leads novos não mostram reativação');

-- 7. "Aplicar aos leads sem origem" não mexe em reativação.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c1', 'admin@entrada.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
VALUES ('00000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'admin');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.reaplicar_origem_leads();
RESET ROLE;
SELECT pg_temp.ok((pg_temp.lead(2)).sales_origin_id IS NULL, 'reaplicar não dá origem à reativação');

ROLLBACK;
