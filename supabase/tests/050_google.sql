-- Testes da conta Google por empresa: cada empresa vê só a sua conexão e ninguém lê o token.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Cliente B');
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'a@teste.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@teste.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'admin');

-- Gravação só pelo servidor (chave de serviço).
SET LOCAL ROLE service_role;
INSERT INTO public.google_conexoes (empresa_id, email, escopos) VALUES
  ('11111111-1111-1111-1111-111111111111', 'turbine@gmail.com', '{drive}'),
  ('22222222-2222-2222-2222-222222222222', 'b@gmail.com', '{drive}');
INSERT INTO public.google_conexao_segredos (empresa_id, refresh_token) VALUES
  ('11111111-1111-1111-1111-111111111111', 'segredo-a'),
  ('22222222-2222-2222-2222-222222222222', 'segredo-b');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT string_agg(email, ',') FROM public.google_conexoes) = 'turbine@gmail.com',
  'empresa vê só a própria conta Google');

DO $$ BEGIN
  PERFORM refresh_token FROM public.google_conexao_segredos;
  RAISE EXCEPTION 'FALHOU: usuário leu o token';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.google_conexoes SET email = 'invasor@gmail.com';
  RAISE EXCEPTION 'FALHOU: usuário alterou a conexão';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.google_conexoes (empresa_id, email) VALUES ('22222222-2222-2222-2222-222222222222', 'x');
  RAISE EXCEPTION 'FALHOU: usuário criou conexão';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  DELETE FROM public.google_conexoes;
  RAISE EXCEPTION 'FALHOU: usuário apagou a conexão';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

-- Desconectar apaga o token junto.
DELETE FROM public.google_conexoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok((SELECT count(*) FROM public.google_conexao_segredos
  WHERE empresa_id = '11111111-1111-1111-1111-111111111111') = 0, 'token apagado com a conexão');

ROLLBACK;
