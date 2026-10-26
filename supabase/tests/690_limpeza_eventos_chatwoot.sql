-- Limpeza dos eventos do Chatwoot (migração 20261213120000): desligada não mexe em nada; ligada
-- apaga os antigos sem uso, enxuga os de mensagem (anexos e remetente ficam), nunca mexe nos
-- recebidos ou com erro, e só o servidor chama. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'

INSERT INTO public.integracao_eventos (id, evento, chave_dedup, empresa_id, status, recebido_em, payload, resultado) VALUES
  ('69000000-0000-4000-8000-000000000001', 'conversation_updated', 't690-1', :'E', 'processado', now() - interval '10 days', '{"meta": {"x": 1}}', '{"ok": true}'),
  ('69000000-0000-4000-8000-000000000002', 'conversation_updated', 't690-2', :'E', 'processado', now() - interval '3 days', '{"meta": {"x": 1}}', NULL),
  ('69000000-0000-4000-8000-000000000003', 'message_created', 't690-3', :'E', 'processado', now() - interval '40 days',
     '{"content": "oi", "conversation": {"big": true}, "attachments": [{"file_type": "image", "data_url": "https://x.test/a.jpg"}], "sender": {"type": "user", "name": "Atendente", "email": "a@e.test", "avatar": "u"}}', '{"ok": true}'),
  ('69000000-0000-4000-8000-000000000004', 'message_created', 't690-4', :'E', 'processado', now() - interval '10 days', '{"content": "oi", "conversation": {}}', NULL),
  ('69000000-0000-4000-8000-000000000005', 'contact_updated', 't690-5', :'E', 'erro', now() - interval '60 days', '{"x": 1}', NULL),
  ('69000000-0000-4000-8000-000000000006', 'contact_updated', 't690-6', :'E', 'recebido', now() - interval '60 days', '{"x": 1}', NULL);
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, origem)
VALUES ('69000000-0000-4000-8000-0000000000c1', :'E', '5511969000001', 'chatwoot');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_timestamp, raw_event_reference) VALUES
  (:'E', '69000000-0000-4000-8000-0000000000c1', 'Enviada', now() - interval '40 days', '69000000-0000-4000-8000-000000000003'),
  (:'E', '69000000-0000-4000-8000-0000000000c1', 'Recebida', now() - interval '10 days', '69000000-0000-4000-8000-000000000004');

-- Desligada (padrão): nada muda.
SELECT pg_temp.ok((SELECT public.limpar_eventos_chatwoot(100)) = '{"ligada": false}'::jsonb, 'nasce desligada');
SELECT pg_temp.ok((SELECT count(*) FROM public.integracao_eventos WHERE chave_dedup LIKE 't690-%') = 6, 'nada apagado');

-- Ligada.
UPDATE public.configuracoes_plataforma SET valor = 'true' WHERE chave = 'limpeza_eventos_ativa';
SELECT pg_temp.ok((SELECT public.limpar_eventos_chatwoot(100)->>'ligada') = 'true', 'ligada');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.integracao_eventos WHERE chave_dedup = 't690-1'), 'antigo sem uso apagado');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.integracao_eventos WHERE chave_dedup = 't690-2'), 'recente fica');
SELECT pg_temp.ok((SELECT payload = '{"attachments": [{"file_type": "image", "data_url": "https://x.test/a.jpg"}], "sender": {"type": "user", "name": "Atendente", "email": "a@e.test"}}'::jsonb
                          AND resultado IS NULL
                     FROM public.integracao_eventos WHERE chave_dedup = 't690-3'), 'mensagem antiga enxugada (anexos e remetente ficam)');
SELECT pg_temp.ok((SELECT payload ? 'content' FROM public.integracao_eventos WHERE chave_dedup = 't690-4'), 'mensagem de 10 dias fica inteira');
SELECT pg_temp.ok((SELECT count(*) FROM public.integracao_eventos WHERE chave_dedup IN ('t690-5', 't690-6')) = 2, 'erro e recebido nunca mudam');
-- Segunda vez: nada a fazer.
SELECT pg_temp.ok((SELECT (r->>'apagados')::int = 0 AND (r->>'enxugados')::int = 0
                     FROM (SELECT public.limpar_eventos_chatwoot(100) r) x
                    WHERE true), 'segunda vez não repete o que já fez');

-- Só o servidor chama.
SELECT set_config('request.jwt.claims', '{"role": "authenticated"}', true);
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.limpar_eventos_chatwoot(1);
  RAISE EXCEPTION 'FALHOU: usuário chamou a limpeza';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
ROLLBACK;
