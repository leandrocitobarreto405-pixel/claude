-- Alarme de crédito da IA (migração 20261224120000): período por empresa, conversas para a equipe,
-- aviso à Nexa a cada 2 horas, avisos no sininho e fechamento na primeira resposta. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.como(_email text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;
\set E '77000000-0000-4000-8000-000000000001'
\set O '77000000-0000-4000-8000-000000000002'
\set C1 '77000000-0000-4000-8000-0000000000c1'
\set C2 '77000000-0000-4000-8000-0000000000c2'

INSERT INTO auth.users (email) VALUES ('admin770@e.test'), ('outra770@e.test');
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Paradas 770'), (:'O', 'Outra 770');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E'::uuid, 'admin'::public.papel_empresa FROM auth.users WHERE email = 'admin770@e.test'
UNION ALL SELECT id, :'O'::uuid, 'admin' FROM auth.users WHERE email = 'outra770@e.test';

-- 1) primeiro erro: abre o período, avisa a Nexa e põe o aviso no sininho da empresa
CREATE TEMP TABLE r1 AS SELECT * FROM public.ia_registrar_parada(:'E', 'ia', 'credito', :'C1');
SELECT pg_temp.ok((SELECT nova AND avisar_nexa FROM r1), 'primeiro erro abre e avisa a Nexa');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_avisos WHERE empresa_id = :'E' AND tipo = 'alice_pausada'
                    AND mensagem = 'A Alice está pausada; as conversas estão indo para a equipe.' AND so_no_app) = 1,
                  'aviso de pausa no sininho, só no app');

-- 2) mais erros: soma, não repete conversa, não avisa a Nexa de novo (menos de 2 h)
CREATE TEMP TABLE r2 AS SELECT * FROM public.ia_registrar_parada(:'E', 'ia', 'credito', :'C1');
INSERT INTO r2 SELECT * FROM public.ia_registrar_parada(:'E', 'ia', 'credito', :'C2');
INSERT INTO r2 SELECT * FROM public.ia_registrar_parada(:'O', 'ia', 'credito', NULL);
SELECT pg_temp.ok((SELECT bool_and(NOT avisar_nexa) FROM r2), 'sem novo aviso à Nexa antes de 2 h');
SELECT pg_temp.ok((SELECT erros = 3 AND cardinality(conversas) = 2 FROM public.ia_paradas
                    WHERE empresa_id = :'E' AND fim IS NULL), '3 erros e 2 conversas para a equipe');
SELECT pg_temp.ok((SELECT count(*) FROM public.ia_paradas WHERE fim IS NULL AND provedor = 'ia'
                    AND empresa_id IN (:'E', :'O')) = 2, 'um período aberto por empresa');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_avisos WHERE empresa_id = :'E' AND tipo = 'alice_pausada') = 1,
                  'aviso de pausa uma vez só');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ia_parada_hora_de_avisar('ia')), 'repetição só depois de 2 h');

-- 3) passadas 2 horas: a rotina avisa de novo (uma vez)
UPDATE public.ia_paradas SET avisado_nexa_em = now() - interval '2 hours 1 minute', inicio = now() - interval '3 hours'
 WHERE empresa_id IN (:'E', :'O');
CREATE TEMP TABLE r3 AS SELECT * FROM public.ia_parada_hora_de_avisar('ia');
SELECT pg_temp.ok((SELECT count(*) = 1 AND bool_and(empresas >= 2 AND conversas >= 2 AND causa = 'credito') FROM r3),
                  'aviso de 2 em 2 horas com empresas e conversas');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ia_parada_hora_de_avisar('ia')), 'não repete na mesma rodada');

-- 4) voz é separada e não avisa a empresa
CREATE TEMP TABLE r4 AS SELECT * FROM public.ia_registrar_parada(:'E', 'voz', 'autenticacao', NULL);
SELECT pg_temp.ok((SELECT nova AND avisar_nexa FROM r4), 'voz tem aviso próprio à Nexa');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_avisos WHERE empresa_id = :'E' AND tipo = 'alice_pausada') = 1,
                  'voz parada não pausa a Alice no sininho');

-- 5) a empresa vê só o dela; quem é de outra empresa não vê
SELECT pg_temp.como('admin770@e.test');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.ia_paradas) = 2, 'admin vê os períodos da empresa');
DO $n$ BEGIN
  PERFORM public.ia_registrar_parada('77000000-0000-4000-8000-000000000001', 'ia', 'credito', NULL);
  RAISE EXCEPTION 'FALHOU: usuário registrou parada';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $n$;
RESET ROLE;
SELECT pg_temp.como('outra770@e.test');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.ia_paradas) = 1, 'outra empresa vê só o dela');
RESET ROLE;

-- 6) primeira resposta que deu certo fecha tudo do provedor e avisa que a Alice voltou
CREATE TEMP TABLE r6 AS SELECT * FROM public.ia_encerrar_paradas('ia');
SELECT pg_temp.ok((SELECT count(*) FROM r6 WHERE empresa_id IN (:'E', :'O')) = 2, 'fecha as duas empresas');
SELECT pg_temp.ok((SELECT conversas FROM r6 WHERE empresa_id = :'E') = 2, 'devolve as conversas do período');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_avisos WHERE empresa_id = :'E' AND tipo = 'alice_voltou') = 1,
                  'aviso de volta no sininho');
SELECT pg_temp.ok((SELECT count(*) FROM public.ia_paradas WHERE empresa_id = :'E' AND provedor = 'voz' AND fim IS NULL) = 1,
                  'voz continua aberta');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ia_encerrar_paradas('ia')), 'nada a fechar na segunda vez');

-- 7) novo erro depois de fechar abre outro período e avisa a Nexa na hora
CREATE TEMP TABLE r7 AS SELECT * FROM public.ia_registrar_parada(:'E', 'ia', 'credito', NULL);
SELECT pg_temp.ok((SELECT nova AND avisar_nexa FROM r7), 'novo período avisa de novo');

ROLLBACK;
