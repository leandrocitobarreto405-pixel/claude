-- Custo das outras chamadas de IA (migração 20261228500000; arquivo 1060). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set A '10600000-0000-4000-8000-00000000000a'
\set B '10600000-0000-4000-8000-00000000000b'
INSERT INTO public.empresas (id, nome) VALUES (:'A', 'Empresa Fictícia A 1060'), (:'B', 'Empresa Fictícia B 1060');

INSERT INTO public.ia_chamadas (empresa_id, origem, modelo, tokens_entrada, tokens_saida, custo_usd, ok, criado_em) VALUES
  (:'A', 'classificador_toque', 'modelo-ficticio', 1700, 300, 0.000320, true,  '2026-11-05 15:00:00+00'),
  (:'A', 'classificador_toque', 'modelo-ficticio', 1500, 250, 0.000275, true,  '2026-11-06 15:00:00+00'),
  (:'A', 'classificador_toque', 'modelo-ficticio', 0,    0,   0,        false, '2026-11-06 16:00:00+00'),
  (:'A', 'toque_equipe',        'modelo-ficticio', 4000, 200, 0.010000, true,  '2026-11-06 17:00:00+00'),
  (:'B', 'retorno_combinado',   'modelo-ficticio', 900,  40,  0.001100, true,  '2026-11-06 18:00:00+00'),
  (:'A', 'classificador_toque', 'modelo-ficticio', 1700, 300, 0.500000, true,  '2026-10-20 15:00:00+00');

SELECT pg_temp.ok(private.ia_chamadas_custo_usd(:'A', '2026-11-01 03:00:00+00', '2026-12-01 03:00:00+00') = 0.010595,
  'empresa A em novembro (outubro fora, falha sem custo)');
SELECT pg_temp.ok(private.ia_chamadas_custo_usd(:'B', '2026-11-01 03:00:00+00', '2026-12-01 03:00:00+00') = 0.0011,
  'empresa B em novembro');

-- Origem fora do padrão e custo negativo são recusados.
DO $$ BEGIN
  INSERT INTO public.ia_chamadas (empresa_id, origem, modelo) VALUES ('10600000-0000-4000-8000-00000000000a', 'Com Espaço', 'm');
  RAISE EXCEPTION 'FALHOU: origem fora do padrão aceita';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.ia_chamadas (empresa_id, origem, modelo, custo_usd) VALUES ('10600000-0000-4000-8000-00000000000a', 'teste', 'm', -1);
  RAISE EXCEPTION 'FALHOU: custo negativo aceito';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Saldo: carga de 50 em 01/11; as outras chamadas entram no consumido.
DELETE FROM public.configuracoes_plataforma WHERE chave IN ('ia_credito_carregado_usd', 'ia_credito_carregado_em');
INSERT INTO public.configuracoes_plataforma (chave, valor) VALUES
  ('ia_credito_carregado_usd', '50'::jsonb), ('ia_credito_carregado_em', '"2026-11-01"'::jsonb);
SELECT pg_temp.ok(
  (public.ia_saldo_estimado()->>'consumido_outros_usd')::numeric
    = round(private.ia_chamadas_custo_usd(NULL, '2026-11-01 03:00:00+00', 'infinity'), 2),
  'saldo mostra as outras chamadas');
SELECT pg_temp.ok(
  (public.ia_saldo_estimado()->>'consumido_usd')::numeric
    = round((SELECT coalesce(sum(custo_usd), 0) FROM public.ia_execucoes WHERE created_at >= '2026-11-01 03:00:00+00')
        + private.tatiana_custo_usd(NULL, '2026-11-01 03:00:00+00', 'infinity')
        + private.ia_chamadas_custo_usd(NULL, '2026-11-01 03:00:00+00', 'infinity'), 2),
  'consumido = Alice + Tatiana + outras chamadas');

-- Quem não é Nexa não lê a tabela nem o consumo por origem; e ninguém grava pelo app.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"10600000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.ia_chamadas;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHOU: ia_chamadas visível para quem não é Nexa (%)', n; END IF;
  BEGIN
    INSERT INTO public.ia_chamadas (empresa_id, origem, modelo) VALUES ('10600000-0000-4000-8000-00000000000a', 'teste', 'm');
    RAISE EXCEPTION 'FALHOU: gravou em ia_chamadas pelo app';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.ia_chamadas_consumo('2026-11-01');
    RAISE EXCEPTION 'FALHOU: consumo das chamadas aberto para quem não é Nexa';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

ROLLBACK;
