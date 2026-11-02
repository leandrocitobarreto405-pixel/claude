-- Feriados por empresa (migração 20261228420000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

-- Páscoa e feriados móveis.
SELECT pg_temp.ok(private.pascoa(2026) = '2026-04-05', 'Páscoa 2026');
SELECT pg_temp.ok(private.pascoa(2027) = '2027-03-28', 'Páscoa 2027');
SELECT pg_temp.ok(private.pascoa(2025) = '2025-04-20', 'Páscoa 2025');
SELECT pg_temp.ok((SELECT count(*) FROM private.feriados_padrao(2026)) = 15, '15 feriados no padrão');
SELECT pg_temp.ok((SELECT data FROM private.feriados_padrao(2026) WHERE nome = 'Corpus Christi') = '2026-06-04', 'Corpus Christi 2026');
SELECT pg_temp.ok((SELECT data FROM private.feriados_padrao(2026) WHERE nome = 'Carnaval (terça)') = '2026-02-17', 'Carnaval 2026');
SELECT pg_temp.ok((SELECT data FROM private.feriados_padrao(2026) WHERE nome = 'Sexta-feira Santa') = '2026-04-03', 'Sexta Santa 2026');

-- Empresa nova nasce com o calendário (gatilho) e semear de novo não duplica.
\set E '99000000-0000-4000-8000-00000000001a'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 1010');
SELECT pg_temp.ok((SELECT count(*) FROM public.feriados WHERE empresa_id = :'E') = 30, 'empresa nova: 2 anos semeados');
SELECT pg_temp.ok(public.feriados_semear(:'E', extract(year FROM private.hoje_sp())::integer) = 0, 'semear de novo não duplica');
SELECT pg_temp.ok((SELECT count(*) FROM public.feriados WHERE empresa_id = :'E' AND trabalhamos IS NULL) = 30, 'nasce sem decisão');

-- Dia bloqueado: sem decisão bloqueia; "vamos trabalhar" libera; "não vamos" bloqueia; dia comum não.
SELECT pg_temp.ok(public.dia_bloqueado(:'E', '2026-11-20'), 'sem decisão bloqueia');
UPDATE public.feriados SET trabalhamos = true WHERE empresa_id = :'E' AND data = '2026-11-20';
SELECT pg_temp.ok(NOT public.dia_bloqueado(:'E', '2026-11-20'), 'vamos trabalhar libera');
UPDATE public.feriados SET trabalhamos = false WHERE empresa_id = :'E' AND data = '2026-11-20';
SELECT pg_temp.ok(public.dia_bloqueado(:'E', '2026-11-20'), 'não vamos bloqueia');
SELECT pg_temp.ok(NOT public.dia_bloqueado(:'E', '2026-11-19'), 'dia comum não bloqueia');

-- Feriado da empresa (manual) e regra de uma data por empresa.
INSERT INTO public.feriados (empresa_id, data, nome, origem, trabalhamos) VALUES (:'E', '2026-12-24', 'Véspera de Natal', 'manual', false);
SELECT pg_temp.ok(public.dia_bloqueado(:'E', '2026-12-24'), 'feriado manual bloqueia');
DO $$ BEGIN
  INSERT INTO public.feriados (empresa_id, data, nome) VALUES ('99000000-0000-4000-8000-00000000001a', '2026-12-24', 'Repetido');
  RAISE EXCEPTION 'FALHOU: data repetida entrou';
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- Quem é da empresa lê os dela; não grava.
INSERT INTO auth.users (id, email) VALUES ('99000000-0000-4000-8000-00000000002a', 'admin1010@ficticio.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES ('99000000-0000-4000-8000-00000000002a', :'E', 'admin');
SELECT set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-00000000002a","role":"authenticated"}', true);
SELECT set_config('app.empresa_ativa', :'E', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.feriados) = 31, 'admin da empresa lê só os feriados dela');
DO $$ BEGIN
  UPDATE public.feriados SET trabalhamos = true WHERE data = '2026-12-25';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU: authenticated gravou feriado'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
ROLLBACK;
