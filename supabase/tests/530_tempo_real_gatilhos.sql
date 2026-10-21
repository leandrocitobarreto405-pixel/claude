-- Gatilhos do tempo real (migração 20261125120000) com o realtime.send presente, como no
-- Supabase: INSERT em whatsapp_messages e UPDATE em conversas não podem falhar nem deixar de
-- avisar o canal da empresa. (Em 21/10 a função lia NEW.conversa_id em conversas e derrubava
-- o webhook; os testes não pegaram porque aqui não existia realtime.send.) Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

-- Dublê do realtime.send: guarda o que seria mandado ao canal.
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE TABLE realtime.avisos_teste (topic text, event text, payload jsonb, private boolean);
CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO realtime.avisos_teste VALUES (topic, event, payload, private);
$$;

\set E '53000000-0000-0000-0000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 530');
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('53000000-0000-0000-0000-0000000000cc', 'Nexa', 187966, 'token-p530');
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, profile_name)
VALUES ('53000000-0000-0000-0000-0000000000a1', :'E', '5511970005300', 'Cliente Fictício 530');
INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id, whatsapp_contact_id, status)
VALUES ('53000000-0000-0000-0000-0000000000c1', :'E', '53000000-0000-0000-0000-0000000000cc', 5301, '53000000-0000-0000-0000-0000000000a1', 'open');

-- INSERT de mensagem (o que o webhook faz) avisa o canal da empresa com a conversa.
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem)
VALUES (:'E', '53000000-0000-0000-0000-0000000000a1', '53000000-0000-0000-0000-0000000000c1', 'Recebida', 'Texto', 'oi 530', 'chatwoot');
SELECT pg_temp.ok(
  (SELECT count(*) FROM realtime.avisos_teste
    WHERE topic = 'empresa:' || :'E' AND event = 'mudou' AND private
      AND payload->>'tabela' = 'whatsapp_messages'
      AND payload->>'conversa_id' = '53000000-0000-0000-0000-0000000000c1') = 1,
  'mensagem nova avisa o canal da empresa');

-- UPDATE de conversa (o que o webhook e o app fazem) não pode falhar e avisa com o id da conversa.
UPDATE public.conversas SET status = 'pending', ultima_atividade_em = now()
 WHERE id = '53000000-0000-0000-0000-0000000000c1';
SELECT pg_temp.ok(
  (SELECT count(*) FROM realtime.avisos_teste
    WHERE topic = 'empresa:' || :'E' AND payload->>'tabela' = 'conversas'
      AND payload->>'conversa_id' = '53000000-0000-0000-0000-0000000000c1') >= 1,
  'update de conversa avisa o canal da empresa');

-- Se o realtime.send quebrar, a gravação continua (o gatilho engole o erro como aviso).
CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'realtime fora do ar (teste)'; END $$;
SET client_min_messages TO error;
UPDATE public.conversas SET aguardando_desde = now() WHERE id = '53000000-0000-0000-0000-0000000000c1';
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem)
VALUES (:'E', '53000000-0000-0000-0000-0000000000a1', '53000000-0000-0000-0000-0000000000c1', 'Recebida', 'Texto', 'oi de novo 530', 'chatwoot');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_messages WHERE text_content = 'oi de novo 530') = 1,
  'gravação segue mesmo com o realtime fora do ar');

ROLLBACK;
