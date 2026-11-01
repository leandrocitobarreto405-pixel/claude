-- Tatiana, plano de ação (migração 20261228390000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, false);
$$;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set E '98000000-0000-4000-8000-00000000000e'
\set E2 '98000000-0000-4000-8000-00000000002e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 980'), (:'E2', 'Outra Fictícia 980');
INSERT INTO auth.users (email) VALUES ('dona@p980.test'), ('maria@p980.test'), ('outra@p980.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'dona@p980.test'
UNION ALL SELECT id, :'E'::uuid, 'atendente'::papel_empresa FROM auth.users WHERE email = 'maria@p980.test'
UNION ALL SELECT id, :'E2'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'outra@p980.test';
INSERT INTO public.mkt_configuracoes (empresa_id) VALUES (:'E') ON CONFLICT DO NOTHING;

-- O servidor grava o plano do dia; um por dia por empresa.
INSERT INTO public.comercial_planos (empresa_id, dia, acoes, leitura, custo_usd)
VALUES (:'E', '2026-11-02', '[{"indice": 0, "tipo": "oferta_prazo", "titulo": "Oferta para quem achou caro", "status": "sugerida"}]', 'Faltam R$ 24.000.', 0.02);
DO $$ BEGIN
  INSERT INTO public.comercial_planos (empresa_id, dia) VALUES ('98000000-0000-4000-8000-00000000000e', '2026-11-02');
  RAISE EXCEPTION 'FALHOU: aceitou dois planos no mesmo dia';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- A contagem das listas por empresa roda pelo servidor e devolve total/podem por chave.
SELECT pg_temp.ok(
  (SELECT public.comercial_listas_contagem(:'E', '{"N1:30": {"orcamento": {"ate": 30}}, "PP": {"perdido_preco": {}}}'::jsonb))
    = '{"PP": {"total": 0, "podem": 0}, "N1:30": {"total": 0, "podem": 0}}'::jsonb,
  'contagem vazia por chave');

-- Admin lê só o da empresa; atendente e outra empresa não; ninguém grava direto; a contagem é só do servidor.
SELECT pg_temp.como('dona@p980.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_planos) = 1, 'admin vê o plano');
SELECT pg_temp.ok((SELECT acoes->0->>'titulo' FROM public.comercial_planos) = 'Oferta para quem achou caro', 'ações legíveis');
DO $$ BEGIN
  UPDATE public.comercial_planos SET leitura = 'mexi';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU: admin alterou o plano'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  INSERT INTO public.comercial_planos (empresa_id, dia) VALUES ('98000000-0000-4000-8000-00000000000e', '2026-11-03');
  RAISE EXCEPTION 'FALHOU: admin gravou direto';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM public.comercial_listas_contagem('98000000-0000-4000-8000-00000000000e', '{}'::jsonb);
  RAISE EXCEPTION 'FALHOU: pessoa logada chamou a contagem do servidor';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

SELECT pg_temp.como('maria@p980.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_planos) = 0, 'atendente não vê o plano');
RESET ROLE;

SELECT pg_temp.como('outra@p980.test', :'E2');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_planos) = 0, 'outra empresa não vê');
RESET ROLE;
ROLLBACK;
