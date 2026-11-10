-- Custo da Tatiana no saldo e no Consumo (migração 20261228480000; arquivo 1040). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set A '10300000-0000-4000-8000-00000000000a'
\set B '10300000-0000-4000-8000-00000000000b'
INSERT INTO public.empresas (id, nome) VALUES (:'A', 'Empresa Fictícia A 1030'), (:'B', 'Empresa Fictícia B 1030');

-- Empresa A: noite 2,00 + lote 1,00 (já com o relatório do lote) + relatório do lote 0,40 (não
-- soma de novo) + relatório avulso 0,25 + plano 0,05 = 3,30. Empresa B: noite 1,50.
INSERT INTO public.comercial_noites (empresa_id, noite, modo, custo_usd, iniciada_em) VALUES
  (:'A', '2026-11-05', 'ativo', 2.00, '2026-11-06 00:30:00+00'),
  (:'B', '2026-11-05', 'ativo', 1.50, '2026-11-06 00:30:00+00'),
  (:'A', '2026-10-20', 'ativo', 9.00, '2026-10-21 00:30:00+00');
INSERT INTO public.comercial_relatorios (id, empresa_id, periodo, dados, custo_usd, criado_em) VALUES
  ('10300000-0000-4000-8000-0000000000e1', :'A', 'Semana fictícia', '{}', 0.40, '2026-11-08 01:10:00+00'),
  ('10300000-0000-4000-8000-0000000000e2', :'A', 'Base parada fictícia', '{"tipo":"base_parada"}', 0.25, '2026-11-08 01:00:00+00');
INSERT INTO public.comercial_lotes (empresa_id, leads, custo_usd, pedido_em, relatorio_id) VALUES
  (:'A', '{10300000-0000-4000-8000-0000000000f1}', 1.00, '2026-11-08 01:00:00+00', '10300000-0000-4000-8000-0000000000e1');
INSERT INTO public.comercial_planos (empresa_id, dia, custo_usd, criado_em) VALUES
  (:'A', '2026-11-06', 0.05, '2026-11-06 10:00:00+00');

SELECT pg_temp.ok(private.tatiana_custo_usd(:'A', '2026-11-01 03:00:00+00', '2026-12-01 03:00:00+00') = 3.30,
  'empresa A em novembro: 3,30 (relatório do lote não conta duas vezes; outubro fora)');
SELECT pg_temp.ok(private.tatiana_custo_usd(:'B', '2026-11-01 03:00:00+00', '2026-12-01 03:00:00+00') = 1.50,
  'empresa B em novembro: 1,50');
SELECT pg_temp.ok(private.tatiana_custo_usd(NULL, '2026-11-01 03:00:00+00', 'infinity') >= 4.80,
  'sem empresa: soma todas');

-- Saldo: carga de 50 em 01/11; Alice 1,20 na empresa A; Tatiana 4,80 (as duas empresas fictícias).
DELETE FROM public.configuracoes_plataforma WHERE chave IN ('ia_credito_carregado_usd', 'ia_credito_carregado_em');
INSERT INTO public.configuracoes_plataforma (chave, valor) VALUES
  ('ia_credito_carregado_usd', '50'::jsonb), ('ia_credito_carregado_em', '"2026-11-01"'::jsonb);
SELECT pg_temp.ok(
  (public.ia_saldo_estimado()->>'consumido_tatiana_usd')::numeric
    = round(private.tatiana_custo_usd(NULL, '2026-11-01 03:00:00+00', 'infinity'), 2),
  'saldo desconta a Tatiana');
SELECT pg_temp.ok(
  (public.ia_saldo_estimado()->>'consumido_usd')::numeric
    = (public.ia_saldo_estimado()->>'consumido_alice_usd')::numeric
      + (public.ia_saldo_estimado()->>'consumido_tatiana_usd')::numeric,
  'consumido = Alice + Tatiana');

-- Consumo por empresa: só a Nexa.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"10300000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  PERFORM * FROM public.tatiana_consumo_empresas('2026-11-01');
  RAISE EXCEPTION 'FALHOU: consumo da Tatiana aberto para quem não é Nexa';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

ROLLBACK;
