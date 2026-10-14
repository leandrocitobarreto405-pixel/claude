-- Indicadores sem OS de teste: a conversão, as vendas por origem, as OS e os recebimentos do
-- período ignoram OS marcadas como teste (work_orders.eh_teste). A ligação automática de OS a
-- lead também pula OS de teste (uma OS de teste não deve fechar um lead de verdade).
-- Mesma assinatura das funções; nada é apagado.

CREATE OR REPLACE FUNCTION public.indicadores_funil(_de date, _ate date, _entrada text DEFAULT 'receptivo')
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH coorte AS (
    SELECT l.*, public.etapa(l) AS etapa_atual,
           EXISTS (SELECT 1 FROM public.conversas c WHERE c.crm_lead_id = l.id) AS tem_conversa,
           -- OS de teste ligada ao lead: a venda não conta.
           coalesce((SELECT w.eh_teste FROM public.work_orders w WHERE w.id = l.linked_work_order_id), false) AS os_teste
      FROM public.crm_leads l
     WHERE l.first_contact_date BETWEEN _de AND _ate
       AND (_entrada = 'todos' OR l.entrada = _entrada)
  ),
  resposta AS (
    SELECT extract(epoch FROM (primeira_resposta_em - created_at)) / 60 AS minutos
      FROM coorte WHERE tem_conversa AND primeira_resposta_em IS NOT NULL
  ),
  os_coorte AS (
    SELECT DISTINCT w.id, w.total_gross_value
      FROM coorte l JOIN public.work_orders w ON w.id = l.linked_work_order_id
     WHERE w.deleted_at IS NULL AND w.status IS DISTINCT FROM 'Cancelada' AND NOT w.eh_teste
  ),
  orcado AS (
    -- Por lead, o orçamento aprovado mais recente; sem aprovado, o mais recente.
    SELECT DISTINCT ON (q.crm_lead_id) q.total
      FROM public.quotes q JOIN coorte l ON l.id = q.crm_lead_id
     ORDER BY q.crm_lead_id, (q.status IN ('aprovado', 'convertido')) DESC, q.created_at DESC
  ),
  q_periodo AS (
    SELECT * FROM public.quotes
     WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _de AND _ate
  ),
  os_periodo AS (
    SELECT * FROM public.work_orders
     WHERE sale_date BETWEEN _de AND _ate AND deleted_at IS NULL AND status IS DISTINCT FROM 'Cancelada'
       AND NOT eh_teste
  ),
  pag_periodo AS (
    SELECT p.* FROM public.payments p
     WHERE p.payment_date BETWEEN _de AND _ate AND p.is_active AND p.payment_status = 'Pago'
       AND NOT EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id = p.work_order_id AND w.eh_teste)
  ),
  origens AS (
    -- Reativação: em vez da origem (não há anúncio), separa clientes de leads antigos.
    SELECT CASE WHEN l.entrada = 'ativo'
                THEN CASE WHEN l.customer_id IS NOT NULL THEN 'Cliente (retorno)' ELSE 'Lead antigo' END
                ELSE coalesce(o.name, 'Não identificada') END AS origem,
           count(*) AS leads,
           count(*) FILTER (WHERE l.orcamento_em IS NOT NULL) AS orcamentos,
           count(*) FILTER (WHERE l.os_criada_em IS NOT NULL AND NOT l.os_teste) AS vendas,
           coalesce(sum(w.total_gross_value) FILTER (WHERE w.deleted_at IS NULL
             AND w.status IS DISTINCT FROM 'Cancelada' AND NOT w.eh_teste), 0) AS vendido
      FROM coorte l
      LEFT JOIN public.config_options o ON o.id = l.sales_origin_id
      LEFT JOIN public.work_orders w ON w.id = l.linked_work_order_id
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('de', _de, 'ate', _ate),
    'entrada', _entrada,
    -- Quantos leads de cada tipo chegaram no período (para as abas da tela).
    'entradas', (SELECT jsonb_build_object(
        'receptivo', count(*) FILTER (WHERE entrada = 'receptivo'),
        'ativo', count(*) FILTER (WHERE entrada = 'ativo'))
      FROM public.crm_leads WHERE first_contact_date BETWEEN _de AND _ate),
    'funil', (SELECT jsonb_build_object(
        'leads', count(*),
        'responderam', count(*) FILTER (WHERE respondeu_em IS NOT NULL),
        'atendidos', count(*) FILTER (WHERE primeira_resposta_em IS NOT NULL
                                        OR etapa_atual NOT IN ('novo', 'encerrado', 'perdido')),
        'orcamento', count(*) FILTER (WHERE orcamento_em IS NOT NULL),
        'orcamento_enviado', count(*) FILTER (WHERE orcamento_enviado_em IS NOT NULL),
        'orcamento_aprovado', count(*) FILTER (WHERE orcamento_aprovado_em IS NOT NULL OR (os_criada_em IS NOT NULL AND NOT os_teste)),
        'os_criada', count(*) FILTER (WHERE os_criada_em IS NOT NULL AND NOT os_teste),
        'agendado', count(*) FILTER (WHERE agendado_em IS NOT NULL AND NOT os_teste),
        'realizado', count(*) FILTER (WHERE realizado_em IS NOT NULL AND NOT os_teste),
        'faturado', count(*) FILTER (WHERE faturado_em IS NOT NULL AND NOT os_teste),
        'perdidos', count(*) FILTER (WHERE perdido_em IS NOT NULL AND os_criada_em IS NULL),
        'abertos', count(*) FILTER (WHERE is_open))
      FROM coorte),
    'etapas', (SELECT coalesce(jsonb_object_agg(etapa_atual, n), '{}'::jsonb)
                 FROM (SELECT etapa_atual, count(*) AS n FROM coorte GROUP BY 1) e),
    'atendimento', (SELECT jsonb_build_object(
        'conversas', count(*) FILTER (WHERE tem_conversa),
        'respondidos', count(*) FILTER (WHERE tem_conversa AND primeira_resposta_em IS NOT NULL),
        'sem_resposta', count(*) FILTER (WHERE tem_conversa AND primeira_resposta_em IS NULL),
        'primeira_resposta_mediana_min', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY minutos)::numeric, 1) FROM resposta),
        'primeira_resposta_p90_min', (SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY minutos)::numeric, 1) FROM resposta))
      FROM coorte),
    'valores', jsonb_build_object(
        'orcado', (SELECT coalesce(sum(total), 0) FROM orcado),
        'vendido', (SELECT coalesce(sum(total_gross_value), 0) FROM os_coorte),
        'recebido', (SELECT coalesce(sum(p.gross_amount), 0) FROM public.payments p
                      WHERE p.work_order_id IN (SELECT id FROM os_coorte) AND p.is_active AND p.payment_status = 'Pago')),
    'periodo_geral', jsonb_build_object(
        'orcamentos', (SELECT count(*) FROM q_periodo),
        'orcamentos_enviados', (SELECT count(*) FROM q_periodo WHERE status IN ('enviado', 'aprovado', 'recusado', 'convertido')),
        'orcamentos_aprovados', (SELECT count(*) FROM q_periodo WHERE status IN ('aprovado', 'convertido')),
        'orcamentos_recusados', (SELECT count(*) FROM q_periodo WHERE status = 'recusado'),
        'valor_aprovado', (SELECT coalesce(sum(total), 0) FROM q_periodo WHERE status IN ('aprovado', 'convertido')),
        'lucro_medio_aprovado_pct', (SELECT round(avg(lucro_percentual), 1) FROM q_periodo WHERE status IN ('aprovado', 'convertido')),
        'os', (SELECT count(*) FROM os_periodo),
        'vendido', (SELECT coalesce(sum(total_gross_value), 0) FROM os_periodo),
        'ticket_medio', (SELECT round(avg(total_gross_value), 2) FROM os_periodo),
        'recebido', (SELECT coalesce(sum(gross_amount), 0) FROM pag_periodo),
        'recebido_liquido', (SELECT coalesce(sum(net_amount), 0) FROM pag_periodo)),
    'origens', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.leads DESC, o.origem), '[]'::jsonb) FROM origens o)
  );
$$;
REVOKE ALL ON FUNCTION public.indicadores_funil(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.indicadores_funil(date, date, text) TO authenticated, service_role;

-- ---------------------------------------------------------------- ligação automática pula OS de teste
CREATE OR REPLACE FUNCTION public.crm_ligar_os_sem_lead(
  _emp uuid,
  _desde timestamptz DEFAULT '2026-10-13 14:00:00-03'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w record;
  chave text;
  leads uuid[];
  ligadas int := 0;
  sem_lead int := 0;
  varios int := 0;
BEGIN
  FOR w IN
    SELECT o.id, o.os_number, o.empresa_id, c.phone
      FROM public.work_orders o
      LEFT JOIN public.customers c ON c.id = o.customer_id
     WHERE o.empresa_id = _emp
       AND o.deleted_at IS NULL
       AND o.status IS DISTINCT FROM 'Cancelada'
       AND NOT o.eh_teste
       AND o.created_at >= greatest(_desde, now() - interval '7 days')
       AND o.created_at <= now() - interval '10 minutes'
       AND NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.linked_work_order_id = o.id)
       AND NOT EXISTS (SELECT 1 FROM public.ads_eventos e
                        WHERE e.empresa_id = o.empresa_id AND e.tipo = 'vinculo'
                          AND e.resultado IN ('os_ligada_auto', 'os_sem_lead', 'os_varios_leads')
                          AND e.detalhe->>'work_order_id' = o.id::text)
     ORDER BY o.created_at
  LOOP
    chave := private.telefone_chave(private.normalizar_telefone(w.phone));
    leads := ARRAY(
      SELECT l.id FROM public.crm_leads l
       WHERE l.empresa_id = w.empresa_id AND l.is_open AND l.linked_work_order_id IS NULL
         AND chave IS NOT NULL
         AND private.telefone_chave(l.normalized_phone) = chave);
    IF cardinality(leads) = 1 THEN
      PERFORM private.converter_lead_em_os(leads[1], w.id);
      -- O histórico do status diz de onde veio a conversão.
      UPDATE public.crm_status_history h
         SET change_source = 'Vínculo automático',
             notes = 'Lead ligado automaticamente à OS ' || w.os_number || ' pelo telefone.'
       WHERE h.crm_lead_id = leads[1] AND h.change_source = 'Orçamento'
         AND h.changed_at = now();
      INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, detalhe)
      VALUES (w.empresa_id, 'vinculo', 'os_ligada_auto',
              jsonb_build_object('work_order_id', w.id, 'os_number', w.os_number, 'crm_lead_id', leads[1]));
      ligadas := ligadas + 1;
    ELSE
      INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, detalhe)
      VALUES (w.empresa_id, 'vinculo',
              CASE WHEN cardinality(leads) = 0 THEN 'os_sem_lead' ELSE 'os_varios_leads' END,
              jsonb_build_object('work_order_id', w.id, 'os_number', w.os_number,
                                 'leads_abertos', cardinality(leads),
                                 'sem_telefone', chave IS NULL));
      IF cardinality(leads) = 0 THEN sem_lead := sem_lead + 1; ELSE varios := varios + 1; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ligadas', ligadas, 'sem_lead', sem_lead, 'varios_leads', varios);
END $$;
REVOKE ALL ON FUNCTION public.crm_ligar_os_sem_lead(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ligar_os_sem_lead(uuid, timestamptz) TO service_role;
