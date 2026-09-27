-- Dados para o teste do webhook do Chatwoot (chatwoot-webhook.test.mjs).
DO $$ BEGIN CREATE ROLE authenticator LOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT anon, authenticated, service_role TO authenticator;
-- Conexão sem assinatura (conta 187966) e com assinatura (conta 111).
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token, verificar_assinatura) VALUES
 ('c0000000-0000-0000-0000-000000000001', 'Sem assinatura', 187966, repeat('a', 64), false),
 ('c0000000-0000-0000-0000-000000000002', 'Com assinatura', 111, repeat('b', 64), true);
INSERT INTO public.chatwoot_conexao_segredos (conexao_id, webhook_secret) VALUES
 ('c0000000-0000-0000-0000-000000000002', 'segredo-do-webhook');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
 ('c0000000-0000-0000-0000-000000000001', 4242, '11111111-1111-1111-1111-111111111111'),
 ('c0000000-0000-0000-0000-000000000002', 7, '11111111-1111-1111-1111-111111111111');
