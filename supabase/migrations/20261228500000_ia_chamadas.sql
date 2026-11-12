-- Custo de todas as chamadas de IA numa tabela só, com a origem — 11/11, plano aprovado pelo dono.
-- Começa pelo que hoje não é gravado em lugar nenhum: classificador de contexto (antes de cada
-- toque e do envio ao lead do site), frase do retorno combinado e mensagem pronta do toque da
-- equipe. A Alice (ia_execucoes) e a Tatiana (comercial_*) continuam nas tabelas delas; aqui só
-- entra o que não está lá, para nada contar duas vezes.
--
-- Tabela nova, nada é alterado nem apagado nas tabelas que já existem. O saldo estimado passa a
-- descontar também estas chamadas ("consumido_outros_usd").

CREATE TABLE public.ia_chamadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  -- De onde veio a chamada: classificador_toque, classificador_site, retorno_combinado, toque_equipe…
  origem text NOT NULL CHECK (origem ~ '^[a-z0-9_]{2,40}$'),
  modelo text NOT NULL CHECK (length(modelo) BETWEEN 1 AND 80),
  tokens_entrada integer NOT NULL DEFAULT 0 CHECK (tokens_entrada >= 0),
  tokens_saida integer NOT NULL DEFAULT 0 CHECK (tokens_saida >= 0),
  tokens_cache_gravados integer NOT NULL DEFAULT 0 CHECK (tokens_cache_gravados >= 0),
  tokens_cache_lidos integer NOT NULL DEFAULT 0 CHECK (tokens_cache_lidos >= 0),
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  -- false = a chamada falhou (sem custo); serve para ver falhas da conta de IA.
  ok boolean NOT NULL DEFAULT true,
  -- Só identificador interno (conversa, lead); nunca texto de cliente.
  referencia text CHECK (referencia IS NULL OR length(referencia) <= 80),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ia_chamadas_empresa_dia ON public.ia_chamadas (empresa_id, criado_em);
CREATE INDEX idx_ia_chamadas_dia ON public.ia_chamadas (criado_em);

ALTER TABLE public.ia_chamadas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ia_chamadas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ia_chamadas TO authenticated;
GRANT ALL ON public.ia_chamadas TO service_role;
-- Custo em dólar: só a equipe da Nexa vê. Quem grava é o servidor.
CREATE POLICY ia_chamadas_select_nexa ON public.ia_chamadas FOR SELECT TO authenticated
  USING ((SELECT private.is_nexa_admin()));

COMMENT ON TABLE public.ia_chamadas IS 'Custo das chamadas de IA que não são da conversa da Alice (ia_execucoes) nem da Tatiana (comercial_*): uma linha por chamada, com a origem. Só a Nexa lê.';

-- Soma do período (empresa nula = todas).
CREATE OR REPLACE FUNCTION private.ia_chamadas_custo_usd(_empresa uuid, _desde timestamptz, _ate timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum(custo_usd), 0) FROM public.ia_chamadas
   WHERE (_empresa IS NULL OR empresa_id = _empresa)
     AND criado_em >= _desde AND criado_em < _ate
$$;
REVOKE ALL ON FUNCTION private.ia_chamadas_custo_usd(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.ia_chamadas_custo_usd(uuid, timestamptz, timestamptz) TO service_role;

-- Saldo estimado: Alice + Tatiana + as outras chamadas, desde a última carga.
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
  outros numeric;
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
  outros := private.ia_chamadas_custo_usd(NULL, desde, 'infinity'::timestamptz);
  gasto := alice + tatiana + outros;
  RETURN jsonb_build_object(
    'carregado_usd', usd, 'carregado_em', em, 'consumido_usd', round(gasto, 2),
    'consumido_alice_usd', round(alice, 2), 'consumido_tatiana_usd', round(tatiana, 2),
    'consumido_outros_usd', round(outros, 2),
    'restante_usd', round(greatest(usd - gasto, 0), 2),
    'pct_restante', round(greatest(usd - gasto, 0) / usd * 100, 1));
END $function$;
REVOKE ALL ON FUNCTION public.ia_saldo_estimado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_saldo_estimado() TO authenticated, service_role;

-- Painel Nexa › Consumo: as outras chamadas por empresa e origem no mês (só a Nexa).
CREATE OR REPLACE FUNCTION public.ia_chamadas_consumo(_mes date)
RETURNS TABLE(empresa_id uuid, origem text, chamadas bigint, falhas bigint, custo_usd numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ini timestamptz := (date_trunc('month', _mes)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  fim timestamptz := ((date_trunc('month', _mes) + interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo');
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Só a equipe da Nexa vê o consumo das empresas.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.empresa_id, c.origem, count(*) FILTER (WHERE c.ok), count(*) FILTER (WHERE NOT c.ok),
         round(sum(c.custo_usd), 4)
    FROM public.ia_chamadas c
   WHERE c.criado_em >= ini AND c.criado_em < fim
   GROUP BY c.empresa_id, c.origem;
END $$;
REVOKE ALL ON FUNCTION public.ia_chamadas_consumo(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_chamadas_consumo(date) TO authenticated, service_role;

SELECT private.instalar_travas_somente_leitura();
