-- conversas_leituras (migração 20261128120000): cada pessoa só vê e grava as próprias leituras,
-- na empresa ativa; conversa de outra empresa é recusada. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set E1 '55000000-0000-0000-0000-00000000000e'
\set E2 '55000000-0000-0000-0000-00000000000f'
\set U1 '55000000-0000-0000-0000-0000000000a1'
\set U2 '55000000-0000-0000-0000-0000000000a2'
INSERT INTO auth.users (id, email) VALUES (:'U1', 'pessoa1@teste.local'), (:'U2', 'pessoa2@teste.local');
INSERT INTO public.empresas (id, nome) VALUES (:'E1', 'Empresa Fictícia 550 A'), (:'E2', 'Empresa Fictícia 550 B');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES (:'U1', :'E1', 'atendente'), (:'U2', :'E1', 'atendente');
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('55000000-0000-0000-0000-0000000000cc', 'Nexa', 187966, 'token-p550');
INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id, status)
VALUES ('55000000-0000-0000-0000-0000000000c1', :'E1', '55000000-0000-0000-0000-0000000000cc', 5501, 'open'),
       ('55000000-0000-0000-0000-0000000000c2', :'E2', '55000000-0000-0000-0000-0000000000cc', 5502, 'open');

-- Pessoa 1, na empresa A, grava a própria leitura.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'U1', 'role', 'authenticated')::text, true);
SELECT set_config('request.headers', json_build_object('x-empresa-id', :'E1')::text, true);
INSERT INTO public.conversas_leituras (empresa_id, conversa_id, user_id)
VALUES (:'E1', '55000000-0000-0000-0000-0000000000c1', :'U1');
SELECT pg_temp.ok((SELECT count(*) FROM public.conversas_leituras) = 1, 'pessoa 1 vê a própria leitura');

-- Não grava em nome de outra pessoa.
DO $$
BEGIN
  INSERT INTO public.conversas_leituras (empresa_id, conversa_id, user_id)
  VALUES ('55000000-0000-0000-0000-00000000000e', '55000000-0000-0000-0000-0000000000c1', '55000000-0000-0000-0000-0000000000a2');
  RAISE EXCEPTION 'FALHOU: gravou leitura de outra pessoa';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
END $$;

-- Conversa de outra empresa é recusada (gatilho de referências).
DO $$
BEGIN
  INSERT INTO public.conversas_leituras (empresa_id, conversa_id, user_id)
  VALUES ('55000000-0000-0000-0000-00000000000e', '55000000-0000-0000-0000-0000000000c2', '55000000-0000-0000-0000-0000000000a1');
  RAISE EXCEPTION 'FALHOU: aceitou conversa de outra empresa';
EXCEPTION WHEN foreign_key_violation OR insufficient_privilege OR check_violation THEN NULL;
END $$;

-- Pessoa 2 não enxerga a leitura da pessoa 1.
SELECT set_config('request.jwt.claims', json_build_object('sub', :'U2', 'role', 'authenticated')::text, true);
SELECT pg_temp.ok((SELECT count(*) FROM public.conversas_leituras) = 0, 'pessoa 2 não vê leituras alheias');

RESET ROLE;
ROLLBACK;
