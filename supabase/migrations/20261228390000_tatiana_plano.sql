-- Tatiana, gerente do mês, etapa 2 (02/11/2026): plano de ação do dia.
-- Toda manhã a Tatiana propõe 1 a 3 ações (oferta com prazo, encaixe, venda do outro serviço,
-- reativação) com lista, tamanho, modelo, condição, custo e venda esperada. "Aprovar" monta um
-- rascunho no Marketing; o envio continua só pelo "Ativar" de lá. Só o admin lê; só o servidor grava.
CREATE TABLE IF NOT EXISTS public.comercial_planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  dia date NOT NULL,
  -- Números usados na proposta (meta, falta, agenda, públicos), para a tela e para conferir depois.
  contexto jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ações propostas, com a decisão de cada uma (sugerida, aprovada, recusada) e a campanha criada.
  acoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  leitura text,
  modelo text,
  tokens_entrada integer NOT NULL DEFAULT 0,
  tokens_saida integer NOT NULL DEFAULT 0,
  custo_usd numeric(10,5) NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, dia)
);
CREATE INDEX IF NOT EXISTS idx_comercial_planos_empresa ON public.comercial_planos (empresa_id, dia DESC);

ALTER TABLE public.comercial_planos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comercial_planos FROM anon, authenticated;
GRANT SELECT ON public.comercial_planos TO authenticated;
GRANT ALL ON public.comercial_planos TO service_role;
DROP POLICY IF EXISTS comercial_planos_select ON public.comercial_planos;
CREATE POLICY comercial_planos_select ON public.comercial_planos FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  OR (SELECT private.is_nexa_admin()));

-- Contagem das listas para uma empresa dada (a varredura roda sem empresa ativa). Mesma conta de
-- mkt_listas_contagem; só o servidor chama.
CREATE OR REPLACE FUNCTION public.comercial_listas_contagem(_empresa uuid, _opcoes jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS MATERIALIZED (
    SELECT x.*, private.mkt_motivo_fora(false, private.mkt_limite_marketing(_empresa), x.optout, x.interno,
             x.sem_pos_venda, x.agendado_para, x.primeiro_nome, x.ultimo_marketing_em) IS NULL AS pode
      FROM private.mkt_listas_dados(_empresa, NULL) x
  ), c AS (
    SELECT o.key AS k, count(d.contato_id) AS total, count(d.contato_id) FILTER (WHERE d.pode) AS podem
      FROM jsonb_each(CASE WHEN jsonb_typeof(_opcoes) = 'object' THEN _opcoes ELSE '{}'::jsonb END) o
      LEFT JOIN d ON cardinality(private.mkt_familias(o.value, d.em_orcamento, d.dias_orcamento, d.em_conversa,
                       d.dias_conversa, d.dias_cliente, d.perdido_preco_em, d.agendado_para)) > 0
     GROUP BY o.key
  )
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('total', total, 'podem', podem)), '{}'::jsonb) FROM c;
$$;
REVOKE ALL ON FUNCTION public.comercial_listas_contagem(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comercial_listas_contagem(uuid, jsonb) TO service_role;

SELECT private.instalar_travas_somente_leitura();
