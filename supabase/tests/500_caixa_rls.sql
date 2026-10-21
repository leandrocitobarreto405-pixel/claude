-- Caixa de entrada: uma pessoa da empresa A não lê nem grava conversa/mensagem da empresa B,
-- mesmo pedindo a empresa B no cabeçalho (não tem acesso a ela). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text,
           false),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, false);
$$;
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set A '11111111-1111-1111-1111-111111111111'
\set B '50000000-0000-0000-0000-00000000000b'
INSERT INTO public.empresas (id, nome) VALUES (:'B', 'Empresa Fictícia B');
INSERT INTO auth.users (email) VALUES ('atendente-a@p500.test'), ('atendente-b@p500.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'A', 'atendente' FROM auth.users WHERE email = 'atendente-a@p500.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'B', 'atendente' FROM auth.users WHERE email = 'atendente-b@p500.test';

INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('50000000-0000-0000-0000-0000000000cc', 'Nexa', 187966, 'token-p500');
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, profile_name) VALUES
  ('50000000-0000-0000-0000-0000000000a1', :'A', '5511970005001', 'Cliente A Fictício'),
  ('50000000-0000-0000-0000-0000000000b1', :'B', '5511970005002', 'Cliente B Fictício');
INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id, whatsapp_contact_id, status) VALUES
  ('50000000-0000-0000-0000-0000000000c1', :'A', '50000000-0000-0000-0000-0000000000cc', 5001, '50000000-0000-0000-0000-0000000000a1', 'open'),
  ('50000000-0000-0000-0000-0000000000c2', :'B', '50000000-0000-0000-0000-0000000000cc', 5002, '50000000-0000-0000-0000-0000000000b1', 'open');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem) VALUES
  (:'A', '50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000c1', 'Recebida', 'Texto', 'oi da A', 'chatwoot'),
  (:'B', '50000000-0000-0000-0000-0000000000b1', '50000000-0000-0000-0000-0000000000c2', 'Recebida', 'Texto', 'oi da B', 'chatwoot');

-- Atendente da A, na empresa A: vê só a sua conversa e grava a resposta nela.
SELECT pg_temp.como('atendente-a@p500.test', :'A');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.conversas WHERE id IN ('50000000-0000-0000-0000-0000000000c1','50000000-0000-0000-0000-0000000000c2')) = 1, 'A vê só a conversa da A');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_messages WHERE text_content IN ('oi da A','oi da B')) = 1, 'A vê só a mensagem da A');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem, enviada_por)
VALUES ('11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000c1', 'Enviada', 'Texto', 'resposta da A', 'nexa', auth.uid());
SELECT pg_temp.ok((SELECT enviada_por = auth.uid() FROM public.whatsapp_messages WHERE text_content = 'resposta da A'), 'resposta gravada com quem enviou');

-- Tenta gravar na conversa da B (contato da B): o RLS/gatilho de empresa recusa.
SELECT pg_temp.deve_falhar($$
  INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem)
  VALUES ('50000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-0000000000b1', '50000000-0000-0000-0000-0000000000c2', 'Enviada', 'Texto', 'invasão', 'nexa')
$$, 'A grava mensagem na conversa da B');
SELECT pg_temp.deve_falhar($$
  INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem)
  VALUES ('11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000c2', 'Enviada', 'Texto', 'invasão 2', 'nexa')
$$, 'A grava mensagem apontando conversa da B');
SELECT pg_temp.ok((SELECT count(*) FROM public.conversas WHERE id = '50000000-0000-0000-0000-0000000000c2' AND (SELECT public.conversas.id FROM public.conversas WHERE id = '50000000-0000-0000-0000-0000000000c2') IS NOT NULL) = 0, 'A não enxerga a conversa da B nem por id');
RESET ROLE;

-- Pedindo a empresa B no cabeçalho sem ter acesso a ela: nada é lido.
SELECT pg_temp.como('atendente-a@p500.test', :'B');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.conversas) = 0, 'A pedindo B no cabeçalho não lê nada');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_messages) = 0, 'A pedindo B no cabeçalho não lê mensagens');
RESET ROLE;

-- Atendente da B vê a dela.
SELECT pg_temp.como('atendente-b@p500.test', :'B');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_messages WHERE text_content LIKE 'oi da %') = 1, 'B vê só a mensagem da B');
SELECT pg_temp.ok((SELECT text_content FROM public.whatsapp_messages WHERE text_content LIKE 'oi da %') = 'oi da B', 'e é a da B');
RESET ROLE;

ROLLBACK;
\echo '500 caixa RLS: ok'
