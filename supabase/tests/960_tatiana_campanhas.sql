-- Tatiana, desempenho de campanha (migração 20261228370000). Dados fictícios.
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

\set E '96000000-0000-4000-8000-00000000000e'
\set E2 '96000000-0000-4000-8000-00000000002e'
\set K1 '96000000-0000-4000-8000-0000000000c1'
\set K2 '96000000-0000-4000-8000-0000000000c2'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 960'), (:'E2', 'Outra Fictícia 960');
INSERT INTO auth.users (email) VALUES ('dona@p960.test'), ('maria@p960.test'), ('outra@p960.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'dona@p960.test'
UNION ALL SELECT id, :'E'::uuid, 'atendente'::papel_empresa FROM auth.users WHERE email = 'maria@p960.test'
UNION ALL SELECT id, :'E2'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'outra@p960.test';
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, templates, datas_disparo, status)
VALUES (:'K1', :'E', 'Campanha fictícia', 'calendario', '2026-10-01', '{C4}', '{"C4": "tc_oferta_trimestral"}', '{2026-10-14}', 'concluida'),
       (:'K2', :'E2', 'Campanha da outra', 'calendario', '2026-10-01', '{C4}', '{"C4": "tc_oferta_trimestral"}', '{2026-10-14}', 'concluida');

-- O servidor (chave de serviço) grava o acompanhamento.
INSERT INTO public.comercial_campanhas (empresa_id, campanha_id, janela_inicio, janela_fim, encerrada, numeros, respostas, sugestoes, leitura, custo_usd)
VALUES (:'E', :'K1', '2026-10-14 13:00+00', '2026-10-21 13:00+00', true,
        '{"enviados": 120, "responderam": 18, "orcamentos": 5, "fecharam": 2, "vendido": 900, "custo": 38.4, "retorno": 23.4}',
        '{"por_envio": {}, "sem_texto": 0, "exemplos": []}',
        '[{"tipo": "texto", "sugestao": "Abrir com o benefício, não com o desconto."}]', 'Foi bem.', 0.05),
       (:'E2', :'K2', '2026-10-14 13:00+00', '2026-10-21 13:00+00', false, '{}', '{}', NULL, NULL, 0);
-- Uma linha por campanha.
DO $$ BEGIN
  INSERT INTO public.comercial_campanhas (empresa_id, campanha_id, janela_inicio, janela_fim)
  VALUES ('96000000-0000-4000-8000-00000000000e', '96000000-0000-4000-8000-0000000000c1', now(), now());
  RAISE EXCEPTION 'FALHOU: aceitou duas linhas da mesma campanha';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Admin da empresa lê só a dela; atendente e admin de outra empresa não leem.
SELECT pg_temp.como('dona@p960.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_campanhas) = 1, 'admin vê a campanha da empresa');
SELECT pg_temp.ok((SELECT (numeros->>'enviados')::int FROM public.comercial_campanhas) = 120, 'números legíveis');
DO $$ BEGIN
  UPDATE public.comercial_campanhas SET leitura = 'mexi';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU: admin alterou o acompanhamento'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  INSERT INTO public.comercial_campanhas (empresa_id, campanha_id, janela_inicio, janela_fim)
  VALUES ('96000000-0000-4000-8000-00000000000e', '96000000-0000-4000-8000-0000000000c1', now(), now());
  RAISE EXCEPTION 'FALHOU: admin gravou direto';
EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN unique_violation THEN RAISE EXCEPTION 'FALHOU: admin chegou a gravar';
END $$;
DO $$ BEGIN
  DELETE FROM public.comercial_campanhas;
  IF FOUND THEN RAISE EXCEPTION 'FALHOU: admin apagou o acompanhamento'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

SELECT pg_temp.como('maria@p960.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_campanhas) = 0, 'atendente não vê o acompanhamento');
RESET ROLE;

SELECT pg_temp.como('outra@p960.test', :'E2');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_campanhas WHERE empresa_id = :'E') = 0, 'outra empresa não vê');
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_campanhas) = 1, 'outra empresa vê só a dela');
RESET ROLE;

-- Apagar a campanha apaga o acompanhamento (cascata), e a linha some com a empresa.
DELETE FROM public.mkt_campanhas WHERE id = :'K2';
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_campanhas WHERE campanha_id = :'K2') = 0, 'cascata da campanha');
ROLLBACK;
