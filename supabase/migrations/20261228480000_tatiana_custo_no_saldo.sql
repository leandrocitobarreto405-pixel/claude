-- Custo da Tatiana (gerente comercial) no saldo estimado da conta de IA e no Consumo — 10/11, plano
-- aprovado pelo dono. A Tatiana usa a mesma conta de IA da Alice, mas o saldo só descontava a Alice
-- (ia_execucoes). Só leitura: nenhuma tabela muda, nada é apagado.
--
-- Custo da Tatiana = noites + lotes (já somam as fichas e o relatório do próprio lote) + relatórios
-- avulsos (sem lote: base parada, "Alice não soube") + planos do dia + leituras de campanha.
-- comercial_analises e comercial_decisoes ficam fora: já estão dentro das noites e dos lotes.

CREATE OR REPLACE FUNCTION private.tatiana_custo_usd(_empresa uuid, _desde timestamptz, _ate timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT sum(custo_usd) FROM public.comercial_noites
                    WHERE (_empresa IS NULL OR empresa_id = _empresa)
                      AND iniciada_em >= _desde AND iniciada_em < _ate), 0)
       + coalesce((SELECT sum(custo_usd) FROM public.comercial_lotes
                    WHERE (_empresa IS NULL OR empresa_id = _empresa)
                      AND pedido_em >= _desde AND pedido_em < _ate), 0)
       + coalesce((SELECT sum(r.custo_usd) FROM public.comercial_relatorios r
                    WHERE (_empresa IS NULL OR r.empresa_id = _empresa)
                      AND r.criado_em >= _desde AND r.criado_em < _ate
                      AND NOT EXISTS (SELECT 1 FROM public.comercial_lotes l WHERE l.relatorio_id = r.id)), 0)
       + coalesce((SELECT sum(custo_usd) FROM public.comercial_planos
                    WHERE (_empresa IS NULL OR empresa_id = _empresa)
                      AND criado_em >= _desde AND criado_em < _ate), 0)
       + coalesce((SELECT sum(custo_usd) FROM public.comercial_campanhas
                    WHERE (_empresa IS NULL OR empresa_id = _empresa)
                      AND criado_em >= _desde AND criado_em < _ate), 0)
$$;
REVOKE ALL ON FUNCTION private.tatiana_custo_usd(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.tatiana_custo_usd(uuid, timestamptz, timestamptz) TO service_role;

-- Saldo estimado: desconta a Alice e a Tatiana desde a última carga.
CREATE OR REPLACE FUNCTION public.ia_saldo_estimado()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  usd numeric;
  em date;
  desde timestamptz;
  alice numeric;
  tatiana numeric;
  gasto numeric;
BEGIN
  IF NOT (private.is_nexa_admin() OR coalesce(auth.jwt()->>'role', '') = 'service_role'
          OR coalesce(current_setting('request.jwt.claims', true), '') = '') THEN
    RAISE EXCEPTION 'Só a Nexa.' USING ERRCODE = '42501';
  END IF;
  SELECT (valor #>> '{}')::numeric INTO usd FROM public.configuracoes_plataforma WHERE chave = 'ia_credito_carregado_usd';
  SELECT (valor #>> '{}')::date INTO em FROM public.configuracoes_plataforma WHERE chave = 'ia_credito_carregado_em';
  IF usd IS NULL OR usd <= 0 OR em IS NULL THEN RETURN NULL; END IF;
  desde := (em::timestamp AT TIME ZONE 'America/Sao_Paulo');
  SELECT coalesce(sum(custo_usd), 0) INTO alice FROM public.ia_execucoes WHERE created_at >= desde;
  tatiana := private.tatiana_custo_usd(NULL, desde, 'infinity'::timestamptz);
  gasto := alice + tatiana;
  RETURN jsonb_build_object(
    'carregado_usd', usd, 'carregado_em', em, 'consumido_usd', round(gasto, 2),
    'consumido_alice_usd', round(alice, 2), 'consumido_tatiana_usd', round(tatiana, 2),
    'restante_usd', round(greatest(usd - gasto, 0), 2),
    'pct_restante', round(greatest(usd - gasto, 0) / usd * 100, 1));
END $function$;
REVOKE ALL ON FUNCTION public.ia_saldo_estimado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_saldo_estimado() TO authenticated, service_role;

-- Painel Nexa › Consumo: custo da Tatiana por empresa no mês (só a Nexa).
CREATE OR REPLACE FUNCTION public.tatiana_consumo_empresas(_mes date)
RETURNS TABLE(empresa_id uuid, tatiana_custo_usd numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ini timestamptz := (date_trunc('month', _mes)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  fim timestamptz := ((date_trunc('month', _mes) + interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo');
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Só a equipe da Nexa vê o consumo das empresas.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id, round(private.tatiana_custo_usd(e.id, ini, fim), 4)
    FROM public.empresas e WHERE e.ativo;
END $$;
REVOKE ALL ON FUNCTION public.tatiana_consumo_empresas(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tatiana_consumo_empresas(date) TO authenticated, service_role;
