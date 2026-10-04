-- Rascunhos dos modelos de mensagem: só o admin da própria empresa lê, ninguém grava pela tela
-- (só o servidor). Botões novos dos modelos contam como interesse.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.como(_user uuid, _empresa uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _user, 'role', 'authenticated')::text, true),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, true);
$$;

INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Cliente B');
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'a@teste.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'atendente@teste.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@teste.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'atendente'),
  ('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'admin');

SET LOCAL ROLE service_role;
INSERT INTO public.modelos_rascunhos (empresa_id, template_nome, form, origem) VALUES
  ('11111111-1111-1111-1111-111111111111', 'tc_oferta_trimestral', '{"corpo": "Oi, {{1}}!"}', 'textos novos'),
  ('22222222-2222-2222-2222-222222222222', 'oferta_trimestral', '{"corpo": "Olá, {{1}}!"}', NULL);
RESET ROLE;

-- 1. Admin da Turbine vê só o da Turbine; atendente não vê; admin da outra empresa vê só o dela.
SELECT pg_temp.como('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT string_agg(template_nome, ',') FROM public.modelos_rascunhos) = 'tc_oferta_trimestral',
  'admin vê só o rascunho da própria empresa');
DO $$ BEGIN
  INSERT INTO public.modelos_rascunhos (empresa_id, template_nome, form)
  VALUES ('11111111-1111-1111-1111-111111111111', 'x', '{}');
  RAISE EXCEPTION 'FALHOU: gravou pela tela';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.como('00000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.modelos_rascunhos) = 0, 'atendente não vê rascunhos');
RESET ROLE;
SELECT pg_temp.como('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT string_agg(template_nome, ',') FROM public.modelos_rascunhos) = 'oferta_trimestral',
  'outra empresa vê só o dela');
RESET ROLE;

-- 2. Nome inválido não entra.
DO $$ BEGIN
  INSERT INTO public.modelos_rascunhos (empresa_id, template_nome, form)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Nome Com Espaço', '{}');
  RAISE EXCEPTION 'FALHOU: aceitou nome inválido';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- 3. Botões novos = interesse (empresa nova e a que já existia).
SELECT pg_temp.ok((private.mkt_config('22222222-2222-2222-2222-222222222222')).botoes
                    @> '{"quero aproveitar": "interesse", "me mostre as datas": "interesse",
                         "quero renovar": "interesse", "quero um orcamento": "interesse",
                         "nao quero mais ofertas": "optout", "agora nao": "recusou"}',
  'botões novos contam como interesse');
SELECT pg_temp.ok(btrim(private.texto_busca('Quero aproveitar!')) = 'quero aproveitar'
               AND btrim(private.texto_busca('Quero um orçamento')) = 'quero um orcamento',
  'o texto do botão vira a chave');
ROLLBACK;
