-- 1. rotas_distancias: km pelas ruas (só a ida) já consultados no roteador, para não repetir a
--    consulta. Origem e destino arredondados a 5 casas (~1 m). Só o servidor (chave de serviço) lê
--    e grava, sempre filtrando pela empresa; valores com mais de 90 dias são consultados de novo.
-- 2. Campanha: quem está na janela do lembrete de higienização 6 meses ou do 13º mês da
--    impermeabilização (ou recebeu um desses lembretes nos últimos 30 dias) fica fora da campanha,
--    porque o lembrete já fala com essa pessoa. A contagem da campanha já segue a regra; a
--    preparação passa a seguir com a parte 2 (SQL Editor).

-- ================================================================ 1. rotas_distancias
CREATE TABLE IF NOT EXISTS public.rotas_distancias (
  empresa_id uuid NOT NULL DEFAULT private.empresa_ativa() REFERENCES public.empresas(id),
  origem_lat numeric(8, 5) NOT NULL,
  origem_lon numeric(8, 5) NOT NULL,
  destino_lat numeric(8, 5) NOT NULL,
  destino_lon numeric(8, 5) NOT NULL,
  km numeric(8, 1) NOT NULL CHECK (km >= 0),
  calculado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, origem_lat, origem_lon, destino_lat, destino_lon)
);
COMMENT ON TABLE public.rotas_distancias IS
  'Km pelas ruas (só a ida) já consultados; recalculado depois de 90 dias. Só o servidor usa.';
ALTER TABLE public.rotas_distancias ENABLE ROW LEVEL SECURITY;
-- Sem políticas para usuários: só a chave de serviço (que ignora RLS) lê e grava.
REVOKE ALL ON public.rotas_distancias FROM anon, authenticated;
GRANT ALL ON public.rotas_distancias TO service_role;

-- ================================================================ 2. janela dos lembretes
-- Higienização entre 5 e 7 meses, impermeabilização entre 12 e 13 meses (o último serviço), ou um
-- lembrete de 6 meses / 13º mês enviado ou na fila nos últimos 30 dias.
CREATE OR REPLACE FUNCTION private.mkt_na_janela_lembrete(_contato uuid, _hoje date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mkt_contatos c
     WHERE c.id = _contato AND c.ultimo_servico_em IS NOT NULL
       AND ((c.ultimo_servico_tipo = 'higienizacao'
             AND _hoje BETWEEN (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '5 months'
                           AND (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '7 months')
         OR (c.ultimo_servico_tipo = 'impermeabilizacao'
             AND _hoje BETWEEN (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '12 months'
                           AND (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '13 months'))
  ) OR EXISTS (
    SELECT 1 FROM public.mkt_envios e JOIN public.mkt_campanhas k ON k.id = e.campanha_id
     WHERE e.contato_id = _contato AND k.tipo = 'gatilho' AND k.gatilho IN ('C2', 'C3', 'C3L')
       AND e.status IN ('enviado', 'enviando', 'pendente', 'manual')
       AND coalesce(e.enviado_em, e.agendado_para, e.created_at)
           > (_hoje - 30)::timestamp AT TIME ZONE 'America/Sao_Paulo'
  );
$$;
REVOKE ALL ON FUNCTION private.mkt_na_janela_lembrete(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mkt_na_janela_lembrete(uuid, date) TO service_role;

-- Contagem da campanha: igual à anterior, sem quem está na janela dos lembretes.
CREATE OR REPLACE FUNCTION public.mkt_campanha_contagem(_campanha uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH emp AS (SELECT private.mkt_empresa_marketing() AS id),
  k AS (
    SELECT c.* FROM public.mkt_campanhas c, emp WHERE c.id = _campanha AND c.empresa_id = emp.id
  ), segs AS (
    SELECT s.value AS seg, s.ord
      FROM k, jsonb_array_elements(private.mkt_listas_da_campanha(k.listas, k.grupos)) WITH ORDINALITY s(value, ord)
  ), d AS MATERIALIZED (
    SELECT x.*, private.mkt_motivo_fora(false, private.mkt_limite_marketing(emp.id), x.optout, x.interno,
             x.sem_pos_venda, x.agendado_para, x.primeiro_nome, x.ultimo_marketing_em) IS NULL
             AND x.agendado_para IS NULL
             AND NOT private.mkt_na_janela_lembrete(x.contato_id, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
             AS pode
      FROM emp, private.mkt_listas_dados(emp.id, NULL) x
      WHERE EXISTS (SELECT 1 FROM k)
  ), c AS (
    SELECT s.seg ->> 'grupo' AS grupo, s.ord, count(d.contato_id) AS total,
           count(d.contato_id) FILTER (WHERE d.pode) AS podem
      FROM segs s
      LEFT JOIN d ON cardinality(private.mkt_familias(
                       jsonb_build_object(s.seg ->> 'familia', s.seg - 'grupo' - 'familia'),
                       d.em_orcamento, d.dias_orcamento, d.em_conversa, d.dias_conversa, d.dias_cliente,
                       d.perdido_preco_em, d.agendado_para)) > 0
     GROUP BY s.seg, s.ord
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('grupo', grupo, 'total', total, 'podem', podem) ORDER BY ord),
                  '[]'::jsonb)
    FROM c;
$$;
REVOKE ALL ON FUNCTION public.mkt_campanha_contagem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mkt_campanha_contagem(uuid) TO authenticated, service_role;
