-- Consumo das empresas (migração 20261214120000): soma do mês por empresa, agenda contando o texto
-- extra do modelo, mês pelo horário de São Paulo, só a Nexa vê. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;
\set E '11111111-1111-1111-1111-111111111111'

INSERT INTO auth.users (email) VALUES ('nexa700@nexa.test'), ('admin700@turbine.test');
INSERT INTO public.plataforma_usuarios (user_id, papel) SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa700@nexa.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E', 'admin' FROM auth.users WHERE email = 'admin700@turbine.test';

-- Março/2030, horário de São Paulo (01/03 00:30 em SP = 03:30 UTC).
INSERT INTO public.ia_execucoes (empresa_id, modelo, custo_usd, mensagens_enviadas, erro, created_at) VALUES
  (:'E', 'm', 0.10, ARRAY['oi', 'tudo bem?'], NULL, '2030-03-01 03:30+00'),
  (:'E', 'm', 0.05, ARRAY[]::text[], 'falhou', '2030-03-10 12:00+00'),
  (:'E', 'm', 9.99, ARRAY['fora'], NULL, '2030-03-01 02:30+00');  -- 28/02 23:30 em SP: fora
INSERT INTO public.ia_audios_uso (empresa_id, voz, situacao, custo_reais, created_at) VALUES
  (:'E', 'v', 'enviado', 0.30, '2030-03-05 12:00+00'),
  (:'E', 'v', 'teste', 0.20, '2030-03-05 12:00+00');
INSERT INTO public.technicians (id, empresa_id, name) VALUES ('70000000-0000-4000-8000-000000000001', :'E', 'Técnico 700');
INSERT INTO public.agenda_tecnicos_envios (empresa_id, tecnico_id, dia_agenda, situacao, via, enviado_em, texto_enviado_em) VALUES
  (:'E', '70000000-0000-4000-8000-000000000001', '2030-03-02', 'enviado', 'texto', '2030-03-01 21:00+00', '2030-03-01 21:00+00'),
  (:'E', '70000000-0000-4000-8000-000000000001', '2030-03-03', 'enviado', 'modelo', '2030-03-02 21:00+00', '2030-03-02 22:00+00'),
  (:'E', '70000000-0000-4000-8000-000000000001', '2030-03-04', 'aguardando', 'modelo', '2030-03-03 21:00+00', NULL),
  (:'E', '70000000-0000-4000-8000-000000000001', '2030-03-05', 'erro', NULL, NULL, NULL);

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'nexa700@nexa.test'), 'role', 'authenticated')::text, false);
SELECT set_config('request.headers', '{}', false);
SET ROLE authenticated;
CREATE TEMP TABLE c700 AS SELECT * FROM public.consumo_empresas('2030-03-15') WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok((SELECT ia_respostas = 1 AND ia_mensagens = 2 AND ia_custo_usd = 0.15 FROM c700), 'IA do mês (o de 28/02 em SP fica fora)');
SELECT pg_temp.ok((SELECT audios = 1 AND audio_custo_reais = 0.50 FROM c700), 'áudio: 1 enviado, custo com o teste');
SELECT pg_temp.ok((SELECT agenda_mensagens = 4 FROM c700), 'agenda: texto 1 + modelo com texto 2 + modelo sem texto 1');
SELECT pg_temp.ok((SELECT mkt_mensagens = 0 AND pos_atendimento_mensagens = 0 FROM c700), 'sem campanha nem pós-atendimento');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.consumo_empresas('2030-03-15') WHERE nome = 'Modelo Nexa (não usar)'), 'modelo (inativo) fora');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'admin700@turbine.test'), 'role', 'authenticated')::text, false);
SELECT set_config('request.headers', json_build_object('x-empresa-id', :'E')::text, false);
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM * FROM public.consumo_empresas('2030-03-15');
  RAISE EXCEPTION 'FALHOU: admin de empresa viu o consumo';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
ROLLBACK;
