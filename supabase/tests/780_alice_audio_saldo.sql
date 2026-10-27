-- Áudio com a ElevenLabs e saldo estimado da conta da IA (migração 20261225120000). Dados fictícios.
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
\set E '78000000-0000-4000-8000-000000000001'

INSERT INTO auth.users (email) VALUES ('admin780@e.test');
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Saldo 780');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E'::uuid, 'admin'::public.papel_empresa FROM auth.users WHERE email = 'admin780@e.test';

-- 1) colunas novas: explicações em áudio começam desligadas; teto em créditos opcional
INSERT INTO public.ia_configuracoes (empresa_id) VALUES (:'E') ON CONFLICT (empresa_id) DO NOTHING;
SELECT pg_temp.ok((SELECT NOT audio_explicacoes AND audio_limite_diario_creditos IS NULL
                     FROM public.ia_configuracoes WHERE empresa_id = :'E'), 'áudio de explicação começa desligado');
DO $n$ BEGIN
  UPDATE public.ia_configuracoes SET audio_limite_diario_creditos = 0 WHERE empresa_id = '78000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'FALHOU: teto zero aceito';
EXCEPTION WHEN check_violation THEN NULL;
END $n$;

-- 2) sem carga anotada: sem saldo
DELETE FROM public.configuracoes_plataforma WHERE chave IN ('ia_credito_carregado_usd', 'ia_credito_carregado_em', 'ia_saldo_avisos');
DELETE FROM public.ia_execucoes;
SELECT pg_temp.ok(public.ia_saldo_estimado() IS NULL, 'sem carga, sem saldo');

-- 3) carga de US$ 100 em 01/03/2030; gasto antes da data não conta
INSERT INTO public.configuracoes_plataforma (chave, valor) VALUES
  ('ia_credito_carregado_usd', '100'), ('ia_credito_carregado_em', '"2030-03-01"');
INSERT INTO public.ia_execucoes (empresa_id, modelo, custo_usd, mensagens_enviadas, created_at) VALUES
  (:'E', 'm', 50, ARRAY['oi'], '2030-03-01 02:30+00'),   -- 28/02 23:30 em SP: antes da carga
  (:'E', 'm', 65, ARRAY['oi'], '2030-03-02 12:00+00');
SELECT pg_temp.ok((public.ia_saldo_estimado()->>'restante_usd')::numeric = 35, 'desconta o gasto desde a carga');
CREATE TEMP TABLE a1 AS SELECT * FROM public.ia_saldo_hora_de_avisar();
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM a1), 'acima de 30%: sem aviso');

-- 4) cruza 30%: avisa uma vez; cruza 10%: avisa uma vez
INSERT INTO public.ia_execucoes (empresa_id, modelo, custo_usd, mensagens_enviadas, created_at)
VALUES (:'E', 'm', 10, ARRAY['oi'], '2030-03-03 12:00+00');
CREATE TEMP TABLE a2 AS SELECT * FROM public.ia_saldo_hora_de_avisar();
SELECT pg_temp.ok((SELECT nivel = 30 AND restante_usd = 25 FROM a2), 'aviso de 30%');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ia_saldo_hora_de_avisar()), '30% só uma vez');
INSERT INTO public.ia_execucoes (empresa_id, modelo, custo_usd, mensagens_enviadas, created_at)
VALUES (:'E', 'm', 20, ARRAY['oi'], '2030-03-04 12:00+00');
CREATE TEMP TABLE a3 AS SELECT * FROM public.ia_saldo_hora_de_avisar();
SELECT pg_temp.ok((SELECT nivel = 10 FROM a3), 'aviso de 10%');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ia_saldo_hora_de_avisar()), '10% só uma vez');

-- 5) carga nova zera os avisos
UPDATE public.configuracoes_plataforma SET valor = '200' WHERE chave = 'ia_credito_carregado_usd';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ia_saldo_hora_de_avisar()), 'carga nova com saldo alto: sem aviso');
SELECT pg_temp.ok((SELECT valor->>'carga' FROM public.configuracoes_plataforma WHERE chave = 'ia_saldo_avisos') IS DISTINCT FROM '200@2030-03-01'
                  OR NOT ((SELECT valor FROM public.configuracoes_plataforma WHERE chave = 'ia_saldo_avisos') ? '30'),
                  'marcas da carga antiga não valem');

-- 6) empresa não vê o saldo da Nexa
SELECT pg_temp.como('admin780@e.test');
SET ROLE authenticated;
DO $n$ BEGIN
  PERFORM public.ia_saldo_estimado();
  RAISE EXCEPTION 'FALHOU: empresa viu o saldo';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $n$;
RESET ROLE;
ROLLBACK;
