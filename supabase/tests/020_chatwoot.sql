-- Testes da integração Chatwoot → Nexa OS (Etapa 3). Rodam numa transação desfeita no final.
-- Os payloads seguem o formato do webhook do Chatwoot (Message#webhook_data e
-- Conversation#webhook_data, lidos no código-fonte oficial).
BEGIN;

-- ---------------------------------------------------------------- helpers
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

-- Conversa no formato do webhook (id = display_id, datas em epoch).
CREATE FUNCTION pg_temp.conversa(_evento text, _display int, _inbox int, _contato int, _fone text,
  _nome text, _status text DEFAULT 'open', _atualizado numeric DEFAULT 1790000000.5,
  _conta int DEFAULT 187966) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'event', _evento,
    'id', _display,
    'inbox_id', _inbox,
    'status', _status,
    'labels', jsonb_build_array('orcamento'),
    'channel', 'Channel::Whatsapp',
    'meta', jsonb_build_object(
      'sender', jsonb_build_object('id', _contato, 'name', _nome, 'phone_number', _fone, 'type', 'contact'),
      'assignee', jsonb_build_object('id', 5, 'name', 'Maria', 'type', 'user')),
    'contact_inbox', jsonb_build_object('source_id', regexp_replace(_fone, '\D', '', 'g')),
    'additional_attributes', jsonb_build_object('referral', jsonb_build_object('source_id', 'ad-123')),
    'first_reply_created_at', 0,
    'waiting_since', 1790000000,
    'created_at', 1790000000,
    'last_activity_at', 1790000000,
    'timestamp', 1790000000,
    'updated_at', _atualizado,
    'account', jsonb_build_object('id', _conta, 'name', 'Nexa')));
$$;

CREATE FUNCTION pg_temp.mensagem(_id int, _display int, _inbox int, _contato int, _fone text, _nome text,
  _tipo text, _texto text, _quando text, _remetente jsonb DEFAULT NULL, _privada boolean DEFAULT false,
  _evento text DEFAULT 'message_created', _conta int DEFAULT 187966) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'event', _evento,
    'id', _id,
    'content', _texto,
    'content_type', 'text',
    'message_type', _tipo,
    'private', _privada,
    'created_at', _quando,
    'source_id', 'wamid.' || _id,
    'sender', coalesce(_remetente,
      jsonb_build_object('id', _contato, 'name', _nome, 'phone_number', _fone)),
    'inbox', jsonb_build_object('id', _inbox, 'name', 'WhatsApp'),
    'account', jsonb_build_object('id', _conta, 'name', 'Nexa'),
    'conversation', pg_temp.conversa('x', _display, _inbox, _contato, _fone, _nome) - 'event' - 'account');
$$;

CREATE FUNCTION pg_temp.receber(_payload jsonb, _token text DEFAULT 'token-teste') RETURNS jsonb
LANGUAGE sql AS $$ SELECT public.receber_evento_chatwoot(_token, 'delivery-x', _payload); $$;

-- ---------------------------------------------------------------- cenário
INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Cliente B');
INSERT INTO public.config_options (empresa_id, kind, name, display_order)
VALUES ('22222222-2222-2222-2222-222222222222', 'crm_status', 'Novo contato', 1);

INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('33333333-3333-3333-3333-333333333333', 'Nexa', 187966, 'token-teste');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id, nome) VALUES
  ('33333333-3333-3333-3333-333333333333', 12, '11111111-1111-1111-1111-111111111111', 'WhatsApp Turbine'),
  ('33333333-3333-3333-3333-333333333333', 34, '22222222-2222-2222-2222-222222222222', 'WhatsApp Cliente B');

INSERT INTO public.customers (empresa_id, full_name, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'João já cliente', '(11) 98765-4321');

CREATE TEMP TABLE r (nome text PRIMARY KEY, v jsonb);
GRANT ALL ON r TO PUBLIC;

-- 1. Conversa nova cria contato, conversa e lead na empresa da caixa.
INSERT INTO r VALUES ('c1', pg_temp.receber(
  pg_temp.conversa('conversation_created', 431, 12, 77, '+55 11 98765-4321', 'João')));
SELECT pg_temp.ok((SELECT v->>'status' FROM r WHERE nome = 'c1') = 'processado', 'conversa processada');
SELECT pg_temp.ok((SELECT (v->>'lead_criado')::boolean AND (v->>'contato_criado')::boolean FROM r WHERE nome = 'c1'),
  'lead e contato criados');
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_leads
  WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND source_type = 'Chatwoot') = 1, 'um lead na Turbine');
SELECT pg_temp.ok((SELECT s.name FROM public.crm_leads l JOIN public.config_options s ON s.id = l.status_id
  WHERE l.id = (SELECT (v->>'lead_id')::uuid FROM r WHERE nome = 'c1')) = 'Novo contato', 'lead com status inicial');
SELECT pg_temp.ok((SELECT customer_id IS NOT NULL FROM public.crm_leads
  WHERE id = (SELECT (v->>'lead_id')::uuid FROM r WHERE nome = 'c1')), 'lead vinculado ao cliente existente pelo telefone');
SELECT pg_temp.ok((SELECT referral_data->'additional_attributes'->'referral'->>'source_id' FROM public.crm_leads
  WHERE id = (SELECT (v->>'lead_id')::uuid FROM r WHERE nome = 'c1')) = 'ad-123', 'dados de anúncio guardados no lead');
SELECT pg_temp.ok((SELECT normalized_phone FROM public.whatsapp_contacts
  WHERE id = (SELECT (v->>'contato_id')::uuid FROM r WHERE nome = 'c1')) = '5511987654321', 'telefone normalizado');
SELECT pg_temp.ok((SELECT responsavel_nome = 'Maria' AND etiquetas = '{orcamento}' AND status = 'open'
  FROM public.conversas WHERE chatwoot_conversation_id = 431), 'conversa com responsável, etiquetas e status');

-- 2. O mesmo evento de novo não cria nada.
INSERT INTO r VALUES ('c1b', pg_temp.receber(
  pg_temp.conversa('conversation_created', 431, 12, 77, '+55 11 98765-4321', 'João')));
SELECT pg_temp.ok((SELECT (v->>'duplicado')::boolean FROM r WHERE nome = 'c1b'), 'evento repetido é detectado');
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_leads WHERE source_type = 'Chatwoot') = 1, 'repetição não cria lead');
SELECT pg_temp.ok((SELECT count(*) FROM public.integracao_eventos) = 1, 'repetição não cria registro');

-- 3. Mensagem recebida.
INSERT INTO r VALUES ('m1', pg_temp.receber(pg_temp.mensagem(5001, 431, 12, 77, '+55 11 98765-4321', 'João',
  'incoming', 'Oi, quero higienizar meu sofá', '2026-09-27T12:00:00.000Z')));
SELECT pg_temp.ok((SELECT (v->>'mensagem_inserida')::boolean AND NOT (v->>'lead_criado')::boolean FROM r WHERE nome = 'm1'),
  'mensagem gravada no lead existente');
SELECT pg_temp.ok((SELECT total_inbound_messages FROM public.whatsapp_contacts WHERE chatwoot_contact_id = 77
  AND empresa_id = '11111111-1111-1111-1111-111111111111') = 1, 'contador de recebidas');
SELECT pg_temp.ok((SELECT direction = 'Recebida' AND message_type = 'Texto' AND whatsapp_message_id = 'wamid.5001'
  AND message_timestamp = '2026-09-27T12:00:00Z'::timestamptz
  FROM public.whatsapp_messages WHERE chatwoot_message_id = 5001), 'mensagem com direção, tipo, id do WhatsApp e horário');

-- 4. Mensagem repetida.
INSERT INTO r VALUES ('m1b', pg_temp.receber(pg_temp.mensagem(5001, 431, 12, 77, '+55 11 98765-4321', 'João',
  'incoming', 'Oi, quero higienizar meu sofá', '2026-09-27T12:00:00.000Z')));
SELECT pg_temp.ok((SELECT (v->>'duplicado')::boolean FROM r WHERE nome = 'm1b'), 'mensagem repetida detectada');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_messages WHERE chatwoot_message_id = 5001) = 1, 'sem mensagem duplicada');

-- 5. Mensagem editada (message_updated): atualiza o texto, não conta de novo.
INSERT INTO r VALUES ('m1u', pg_temp.receber(pg_temp.mensagem(5001, 431, 12, 77, '+55 11 98765-4321', 'João',
  'incoming', 'Oi, quero higienizar meu sofá de 3 lugares', '2026-09-27T12:00:00.000Z', NULL, false, 'message_updated')));
SELECT pg_temp.ok((SELECT text_content FROM public.whatsapp_messages WHERE chatwoot_message_id = 5001)
  = 'Oi, quero higienizar meu sofá de 3 lugares', 'texto atualizado');
SELECT pg_temp.ok((SELECT total_inbound_messages FROM public.whatsapp_contacts WHERE chatwoot_contact_id = 77
  AND empresa_id = '11111111-1111-1111-1111-111111111111') = 1, 'edição não conta como nova');

-- 6. Resposta do atendente marca a primeira resposta.
INSERT INTO r VALUES ('m2', pg_temp.receber(pg_temp.mensagem(5002, 431, 12, 77, '+55 11 98765-4321', 'João',
  'outgoing', 'Olá João! Me manda uma foto?', '2026-09-27T12:05:00.000Z',
  '{"id": 5, "name": "Maria", "email": "maria@nexa.com", "type": "user"}')));
SELECT pg_temp.ok((SELECT primeira_resposta_em = '2026-09-27T12:05:00Z'::timestamptz FROM public.crm_leads
  WHERE id = (SELECT (v->>'lead_id')::uuid FROM r WHERE nome = 'c1')), 'primeira resposta registrada no lead');
SELECT pg_temp.ok((SELECT remetente_tipo = 'user' AND direction = 'Enviada' FROM public.whatsapp_messages
  WHERE chatwoot_message_id = 5002), 'mensagem do atendente');

-- 7. Nota privada não conta como resposta nem como enviada.
INSERT INTO r VALUES ('m3', pg_temp.receber(pg_temp.mensagem(5003, 431, 12, 77, '+55 11 98765-4321', 'João',
  'outgoing', 'Cliente parece quente', '2026-09-27T12:01:00.000Z',
  '{"id": 5, "name": "Maria", "type": "user"}', true)));
SELECT pg_temp.ok((SELECT privada FROM public.whatsapp_messages WHERE chatwoot_message_id = 5003), 'nota privada marcada');
SELECT pg_temp.ok((SELECT primeira_resposta_em = '2026-09-27T12:05:00Z'::timestamptz FROM public.crm_leads
  WHERE id = (SELECT (v->>'lead_id')::uuid FROM r WHERE nome = 'c1')), 'nota privada não altera a primeira resposta');
SELECT pg_temp.ok((SELECT total_outbound_messages FROM public.whatsapp_contacts WHERE chatwoot_contact_id = 77
  AND empresa_id = '11111111-1111-1111-1111-111111111111') = 1, 'nota privada não conta como enviada');

-- 8. Mensagem de atividade é ignorada.
INSERT INTO r VALUES ('m4', pg_temp.receber(pg_temp.mensagem(5004, 431, 12, 77, '+55 11 98765-4321', 'João',
  'activity', 'Conversa atribuída a Maria', '2026-09-27T12:02:00.000Z')));
SELECT pg_temp.ok((SELECT v->>'status' FROM r WHERE nome = 'm4') = 'ignorado', 'atividade ignorada');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE chatwoot_message_id = 5004), 'atividade não gravada');

-- 9. Fora de ordem: mensagem antes do evento de conversa.
INSERT INTO r VALUES ('m5', pg_temp.receber(pg_temp.mensagem(6001, 432, 12, 88, '+5511911112222', 'Ana',
  'incoming', 'Quanto custa impermeabilizar?', '2026-09-27T13:00:00.000Z')));
SELECT pg_temp.ok((SELECT (v->>'lead_criado')::boolean FROM r WHERE nome = 'm5'), 'mensagem sem conversa prévia cria o lead');
INSERT INTO r VALUES ('c2', pg_temp.receber(pg_temp.conversa('conversation_created', 432, 12, 88, '+5511911112222', 'Ana')));
SELECT pg_temp.ok((SELECT NOT (v->>'lead_criado')::boolean FROM r WHERE nome = 'c2'), 'evento de conversa atrasado não duplica lead');

-- 10. Caixa não mapeada: guarda o evento; depois de mapear, o reprocessamento resolve.
INSERT INTO r VALUES ('u1', pg_temp.receber(pg_temp.mensagem(7001, 600, 99, 99, '+5511933334444', 'Pedro',
  'incoming', 'Oi', '2026-09-27T14:00:00.000Z')));
SELECT pg_temp.ok((SELECT v->>'status' FROM r WHERE nome = 'u1') = 'inbox_nao_mapeado', 'caixa não mapeada fica pendente');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.whatsapp_contacts WHERE chatwoot_contact_id = 99), 'nada gravado sem empresa');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id)
VALUES ('33333333-3333-3333-3333-333333333333', 99, '11111111-1111-1111-1111-111111111111');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO r VALUES ('rp', public.reprocessar_eventos_chatwoot(50));
SELECT set_config('request.jwt.claims', '', true);
SELECT pg_temp.ok((SELECT (v->>'processados')::int >= 1 FROM r WHERE nome = 'rp'), 'reprocessamento processou o pendente');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.crm_leads l JOIN public.whatsapp_contacts c ON c.id = l.whatsapp_contact_id
  WHERE c.chatwoot_contact_id = 99), 'lead criado após mapear a caixa');

-- 11. A mesma pessoa falando com outra empresa: contato e lead separados.
INSERT INTO r VALUES ('b1', pg_temp.receber(pg_temp.conversa('conversation_created', 900, 34, 77, '+55 11 98765-4321', 'João')));
SELECT pg_temp.ok((SELECT (v->>'lead_criado')::boolean AND (v->>'empresa_id')::uuid = '22222222-2222-2222-2222-222222222222'
  FROM r WHERE nome = 'b1'), 'lead criado no Cliente B');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_contacts WHERE normalized_phone = '5511987654321') = 2,
  'um contato por empresa');
SELECT pg_temp.ok((SELECT customer_id IS NULL FROM public.crm_leads
  WHERE id = (SELECT (v->>'lead_id')::uuid FROM r WHERE nome = 'b1')), 'cliente da Turbine não vaza para o Cliente B');

-- 12 e 13. Conta divergente e token inválido são recusados.
SELECT pg_temp.deve_falhar($q$SELECT pg_temp.receber(pg_temp.conversa('conversation_created', 1, 12, 1, '+5511900000000',
  'X', 'open', 1, 1))$q$, 'evento de outra conta do Chatwoot');
SELECT pg_temp.deve_falhar($q$SELECT pg_temp.receber(pg_temp.conversa('conversation_created', 1, 12, 1, '+5511900000000',
  'X'), 'token-errado')$q$, 'token inválido');

-- 14. Decisão D6: lead encerrado há mais de 30 dias → lead novo; há menos → mesmo lead.
UPDATE public.crm_leads SET is_open = false, closed_at = '2026-08-01'::timestamptz
 WHERE id = (SELECT (v->>'lead_id')::uuid FROM r WHERE nome = 'c1');
INSERT INTO r VALUES ('d1', pg_temp.receber(pg_temp.mensagem(8001, 700, 12, 77, '+55 11 98765-4321', 'João',
  'incoming', 'Oi de novo, agora quero impermeabilizar', '2026-09-27T15:00:00.000Z')));
SELECT pg_temp.ok((SELECT (v->>'lead_criado')::boolean FROM r WHERE nome = 'd1'), 'lead novo depois de 30 dias');
UPDATE public.crm_leads SET is_open = false, closed_at = '2026-09-20'::timestamptz
 WHERE id = (SELECT (v->>'lead_id')::uuid FROM r WHERE nome = 'd1');
INSERT INTO r VALUES ('d2', pg_temp.receber(pg_temp.mensagem(8101, 701, 12, 77, '+55 11 98765-4321', 'João',
  'incoming', 'Esqueci de perguntar uma coisa', '2026-09-27T16:00:00.000Z')));
SELECT pg_temp.ok((SELECT NOT (v->>'lead_criado')::boolean FROM r WHERE nome = 'd2'), 'menos de 30 dias: não cria lead');
SELECT pg_temp.ok((SELECT (v->>'lead_id') FROM r WHERE nome = 'd2') = (SELECT (v->>'lead_id') FROM r WHERE nome = 'd1'),
  'conversa volta para o lead anterior');

-- 15. Evento antigo não sobrescreve estado mais novo da conversa.
INSERT INTO r VALUES ('s1', pg_temp.receber(pg_temp.conversa('conversation_updated', 432, 12, 88, '+5511911112222',
  'Ana', 'resolved', 1790000900)));
INSERT INTO r VALUES ('s2', pg_temp.receber(pg_temp.conversa('conversation_status_changed', 432, 12, 88, '+5511911112222',
  'Ana', 'open', 1790000100)));
SELECT pg_temp.ok((SELECT status FROM public.conversas WHERE chatwoot_conversation_id = 432) = 'resolved',
  'status mais recente preservado');

-- 16. Erro fica registrado e não grava nada parcial.
INSERT INTO r VALUES ('e1', pg_temp.receber(jsonb_build_object('event', 'message_created', 'id', 9999,
  'message_type', 'incoming', 'content', 'sem conversa', 'inbox', jsonb_build_object('id', 12),
  'account', jsonb_build_object('id', 187966))));
SELECT pg_temp.ok((SELECT v->>'status' FROM r WHERE nome = 'e1') = 'erro', 'evento inválido marcado como erro');
SELECT pg_temp.ok((SELECT tentativas = 1 AND erro IS NOT NULL FROM public.integracao_eventos
  WHERE id = (SELECT (v->>'evento_id')::uuid FROM r WHERE nome = 'e1')), 'erro e tentativa registrados');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE chatwoot_message_id = 9999), 'nada parcial gravado');

-- 17. Atualização de contato renomeia nas empresas que já o conhecem.
INSERT INTO r VALUES ('ct', pg_temp.receber(jsonb_build_object('event', 'contact_updated', 'id', 77,
  'name', 'João da Silva', 'phone_number', '+5511987654321', 'account', jsonb_build_object('id', 187966))));
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_contacts WHERE chatwoot_contact_id = 77
  AND profile_name = 'João da Silva') = 2, 'contato renomeado nas duas empresas');

-- 18. Isolamento: usuário da Turbine não vê conversas nem eventos do Cliente B.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000b1', 'turbine@teste.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
VALUES ('00000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'admin');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.conversas WHERE empresa_id = '22222222-2222-2222-2222-222222222222') = 0,
  'Turbine não vê conversas do Cliente B');
SELECT pg_temp.ok((SELECT count(*) FROM public.conversas) > 0, 'Turbine vê as próprias conversas');
SELECT pg_temp.ok((SELECT count(*) FROM public.integracao_eventos
  WHERE empresa_id = '22222222-2222-2222-2222-222222222222') = 0, 'Turbine não vê eventos do Cliente B');
SELECT pg_temp.ok((SELECT count(*) FROM public.chatwoot_conexoes) = 0, 'cliente não vê as conexões da Nexa');
SELECT pg_temp.deve_falhar($q$SELECT * FROM public.chatwoot_conexao_segredos$q$, 'cliente lendo segredos');
SELECT pg_temp.deve_falhar($q$SELECT public.receber_evento_chatwoot('token-teste', 'x', '{"event":"x"}')$q$,
  'usuário comum chamando a entrada do webhook');
SELECT pg_temp.deve_falhar($q$SELECT public.reprocessar_eventos_chatwoot(1)$q$, 'cliente reprocessando eventos');
RESET ROLE;

ROLLBACK;
