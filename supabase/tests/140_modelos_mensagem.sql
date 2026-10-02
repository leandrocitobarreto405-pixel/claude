-- Modelos de mensagem: o token da Meta não é lido por ninguém pelo app (nem pelo admin); a conexão
-- e as edições só o admin vê; os textos sem aprovação só o admin altera.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'admin@modelos.dev'),
  ('00000000-0000-0000-0000-0000000000d2', 'atendente@modelos.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111', 'atendente');

-- O servidor (chave de serviço) grava a conexão e o token.
INSERT INTO public.meta_conexoes (empresa_id, waba_id, waba_nome)
VALUES ('11111111-1111-1111-1111-111111111111', '102030405060708', 'Turbine Clean');
INSERT INTO public.meta_conexao_segredos (empresa_id, token)
VALUES ('11111111-1111-1111-1111-111111111111', 'EAAtokendetestecommaisde20caracteres');
INSERT INTO public.modelos_edicoes (empresa_id, template_nome, idioma, acao, status_antes, ok)
VALUES ('11111111-1111-1111-1111-111111111111', 'tc_promocao_agenda', 'pt_BR', 'criar', NULL, true);
DO $$ BEGIN
  INSERT INTO public.meta_conexoes (empresa_id, waba_id)
  VALUES ('22222222-2222-2222-2222-222222222222', 'abc');
  RAISE EXCEPTION 'FALHOU: aceitou WABA inválido';
EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL; END $$;

-- 1. Admin vê a conexão e as edições, mas não o token.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.meta_conexoes) = 1, 'admin vê a conexão');
SELECT pg_temp.ok((SELECT count(*) FROM public.modelos_edicoes) = 1, 'admin vê as edições');
DO $$ BEGIN
  PERFORM 1 FROM public.meta_conexao_segredos;
  RAISE EXCEPTION 'FALHOU: admin leu o token';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.meta_conexoes SET waba_id = '999999999';
  RAISE EXCEPTION 'FALHOU: admin alterou a conexão sem passar pelo servidor';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
-- Admin altera os textos sem aprovação.
INSERT INTO public.mensagens_textos (empresa_id, chave, texto)
VALUES ('11111111-1111-1111-1111-111111111111', 'aviso_espera', '{cliente} está esperando.');
UPDATE public.mensagens_textos SET texto = '{cliente} espera há {minutos} min.' WHERE chave = 'aviso_espera';
DO $$ BEGIN
  INSERT INTO public.mensagens_textos (empresa_id, chave, texto)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Chave Inválida', 'x');
  RAISE EXCEPTION 'FALHOU: aceitou chave inválida';
EXCEPTION WHEN check_violation THEN NULL; END $$;
RESET ROLE;

-- 2. Atendente: não vê conexão, edições nem token; lê os textos mas não altera.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.meta_conexoes) = 0, 'atendente não vê a conexão');
SELECT pg_temp.ok((SELECT count(*) FROM public.modelos_edicoes) = 0, 'atendente não vê as edições');
DO $$ BEGIN
  PERFORM 1 FROM public.meta_conexao_segredos;
  RAISE EXCEPTION 'FALHOU: atendente leu o token';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT pg_temp.ok((SELECT texto FROM public.mensagens_textos WHERE chave = 'aviso_espera')
                  = '{cliente} espera há {minutos} min.', 'atendente lê os textos');
UPDATE public.mensagens_textos SET texto = 'mudei' WHERE chave = 'aviso_espera';
DO $$ BEGIN
  INSERT INTO public.mensagens_textos (empresa_id, chave, texto)
  VALUES ('11111111-1111-1111-1111-111111111111', 'aviso_resumo', 'x');
  RAISE EXCEPTION 'FALHOU: atendente criou texto';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.ok((SELECT texto FROM public.mensagens_textos WHERE chave = 'aviso_espera')
                  = '{cliente} espera há {minutos} min.', 'atendente não alterou o texto');

-- 3. Anônimo não vê nada.
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM public.mensagens_textos;
  RAISE EXCEPTION 'FALHOU: anônimo leu os textos';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

ROLLBACK;
