-- 1ª resposta por pessoa: o sender do Chatwoot vira enviada_por (migração 20261228250000).
-- Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set E '91000000-0000-4000-8000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 910');
INSERT INTO auth.users (id, email) VALUES ('91000000-0000-4000-8000-0000000000a1', 'atendente910@teste.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel, chatwoot_agent_id)
VALUES ('91000000-0000-4000-8000-0000000000a1', :'E', 'atendente', 555);
INSERT INTO public.integracao_eventos (id, provedor, evento, chave_dedup, empresa_id, payload, status) VALUES
  ('91000000-0000-4000-8000-0000000000e1', 'chatwoot', 'message_created', 'd910-1', :'E',
   '{"sender": {"type": "user", "id": 555}}', 'processado'),
  ('91000000-0000-4000-8000-0000000000e2', 'chatwoot', 'message_created', 'd910-2', :'E',
   '{"sender": null, "content_attributes": {"external_echo": true}}', 'processado'),
  ('91000000-0000-4000-8000-0000000000e3', 'chatwoot', 'message_created', 'd910-3', :'E',
   '{"sender": {"type": "user", "id": 999}}', 'processado');

INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone)
VALUES ('91000000-0000-4000-8000-0000000000c1', :'E', '5511900009100');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_type, text_content, message_timestamp,
  remetente_tipo, privada, origem, raw_event_reference) VALUES
  (:'E', '91000000-0000-4000-8000-0000000000c1', 'Enviada', 'Texto', 'a', now(), 'user', false, 'chatwoot', '91000000-0000-4000-8000-0000000000e1'),
  (:'E', '91000000-0000-4000-8000-0000000000c1', 'Enviada', 'Texto', 'b', now(), 'user', false, 'chatwoot', '91000000-0000-4000-8000-0000000000e2'),
  (:'E', '91000000-0000-4000-8000-0000000000c1', 'Enviada', 'Texto', 'c', now(), 'user', false, 'chatwoot', '91000000-0000-4000-8000-0000000000e3'),
  (:'E', '91000000-0000-4000-8000-0000000000c1', 'Enviada', 'Texto', 'd', now(), 'user', true, 'chatwoot', '91000000-0000-4000-8000-0000000000e1');

SELECT pg_temp.ok((SELECT enviada_por FROM public.whatsapp_messages WHERE empresa_id = :'E' AND text_content = 'a')
                  = '91000000-0000-4000-8000-0000000000a1', 'digitada no Chatwoot: atendente mapeada');
SELECT pg_temp.ok((SELECT enviada_por IS NULL FROM public.whatsapp_messages WHERE empresa_id = :'E' AND text_content = 'b'),
                  'eco do celular: sem pessoa (Equipe)');
SELECT pg_temp.ok((SELECT enviada_por IS NULL FROM public.whatsapp_messages WHERE empresa_id = :'E' AND text_content = 'c'),
                  'atendente sem mapeamento: sem pessoa');
SELECT pg_temp.ok((SELECT enviada_por IS NULL FROM public.whatsapp_messages WHERE empresa_id = :'E' AND text_content = 'd'),
                  'nota interna fica de fora');
ROLLBACK;
