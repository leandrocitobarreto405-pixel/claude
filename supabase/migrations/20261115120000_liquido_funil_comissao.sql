-- Valor líquido (sem o repasse a parceiros dos itens terceirizados) nos indicadores do funil e
-- na comissão prevista/realizada das OS. OS sem terceirizado não muda nada. Nada é apagado.

-- Valor da OS que fica com a empresa: o negociado menos o repasse dos atendimentos não cancelados.
CREATE OR REPLACE FUNCTION private.valor_liquido_os(_os uuid, _total numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT greatest(0, coalesce(_total, 0) - coalesce((
    SELECT sum(v.repasse_parceiro) FROM public.visits v
     WHERE v.work_order_id = _os AND v.status IS DISTINCT FROM 'Cancelado'), 0));
$$;
REVOKE ALL ON FUNCTION private.valor_liquido_os(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.valor_liquido_os(uuid, numeric) TO authenticated, service_role;

-- 1. Indicadores do funil: vendido, ticket médio e vendido por origem pelo valor líquido.
--    (Recebido continua sendo o dinheiro que entrou.)
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
    SELECT DISTINCT w.id, private.valor_liquido_os(w.id, w.total_gross_value) AS liquido
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
    SELECT *, private.valor_liquido_os(id, total_gross_value) AS liquido FROM public.work_orders
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
           coalesce(sum(private.valor_liquido_os(w.id, w.total_gross_value)) FILTER (WHERE w.deleted_at IS NULL
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
        'vendido', (SELECT coalesce(sum(liquido), 0) FROM os_coorte),
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
        'vendido', (SELECT coalesce(sum(liquido), 0) FROM os_periodo),
        'ticket_medio', (SELECT round(avg(liquido), 2) FROM os_periodo),
        'recebido', (SELECT coalesce(sum(gross_amount), 0) FROM pag_periodo),
        'recebido_liquido', (SELECT coalesce(sum(net_amount), 0) FROM pag_periodo)),
    'origens', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.leads DESC, o.origem), '[]'::jsonb) FROM origens o)
  );
$$;
GRANT EXECUTE ON FUNCTION public.indicadores_funil(date, date, text) TO authenticated, service_role;


-- 2. Comissão prevista e realizada pelo valor líquido. Mesma conta do app (recalcWorkOrder):
--    prevista = negociado × %, realizada = negociado × parte concluída × %, agora descontando o
--    repasse (todo o repasse na prevista, o dos atendimentos concluídos na realizada).
CREATE OR REPLACE FUNCTION private.comissao_liquida_os(
  _os uuid, _total numeric, _pct numeric, OUT prevista numeric, OUT realizada numeric,
  OUT repasse numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total_ativo numeric;
  base_concluida numeric;
  rep_concluido numeric;
  negociado numeric;
  proporcao numeric;
BEGIN
  SELECT coalesce(sum(CASE WHEN coalesce(final_value, 0) > 0 THEN final_value
                           ELSE coalesce(visit_value, 0) END), 0),
         coalesce(sum(CASE WHEN status = 'Concluído' THEN
                        CASE WHEN coalesce(final_value, 0) > 0 THEN final_value
                             ELSE coalesce(visit_value, 0) END END), 0),
         coalesce(sum(repasse_parceiro), 0),
         coalesce(sum(repasse_parceiro) FILTER (WHERE status = 'Concluído'), 0)
    INTO total_ativo, base_concluida, repasse, rep_concluido
    FROM public.visits
   WHERE work_order_id = _os AND status IS DISTINCT FROM 'Cancelado';
  negociado := coalesce(nullif(_total, 0), round(total_ativo, 2));
  proporcao := CASE WHEN total_ativo > 0 THEN base_concluida / total_ativo ELSE 0 END;
  prevista := round(greatest(0, negociado - repasse) * coalesce(_pct, 0) / 100, 2);
  realizada := round(greatest(0, negociado * proporcao - rep_concluido) * coalesce(_pct, 0) / 100, 2);
END $$;
REVOKE ALL ON FUNCTION private.comissao_liquida_os(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;

-- Quem grava a comissão (telas, Alice, recálculo da OS) grava o bruto; com repasse, o banco troca
-- pelo líquido. Sem repasse, fica o que o app mandou.
CREATE OR REPLACE FUNCTION private.trg_os_comissao_liquida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  c := private.comissao_liquida_os(NEW.id, NEW.total_gross_value, NEW.commission_percentage_snapshot);
  IF c.repasse > 0 THEN
    NEW.commission_expected := c.prevista;
    NEW.commission_realized := c.realizada;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.trg_os_comissao_liquida() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_work_orders_comissao_liquida
  BEFORE UPDATE OF total_gross_value, commission_percentage_snapshot, commission_expected,
    commission_realized ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION private.trg_os_comissao_liquida();

-- Repasse do atendimento mudou (custo preenchido, item desativado, atendimento concluído ou
-- reaberto): recalcula a comissão da OS na hora, inclusive quando o repasse volta a zero.
CREATE OR REPLACE FUNCTION private.recalcular_comissao_os(_os uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w record;
  c record;
BEGIN
  SELECT id, total_gross_value, commission_percentage_snapshot INTO w
    FROM public.work_orders WHERE id = _os;
  IF NOT FOUND THEN RETURN; END IF;
  c := private.comissao_liquida_os(w.id, w.total_gross_value, w.commission_percentage_snapshot);
  UPDATE public.work_orders
     SET commission_expected = c.prevista, commission_realized = c.realizada
   WHERE id = _os
     AND (commission_expected IS DISTINCT FROM c.prevista
          OR commission_realized IS DISTINCT FROM c.realizada);
END $$;
REVOKE ALL ON FUNCTION private.recalcular_comissao_os(uuid) FROM PUBLIC, anon, authenticated;

-- O sincronizador do repasse (20261114120000) passa a recalcular a comissão da OS.
CREATE OR REPLACE FUNCTION private.sincronizar_repasse_parceiro(_visita uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
  total numeric;
  parceiros text;
  chave text := 'repasse:' || _visita;
  atual public.expenses%ROWTYPE;
BEGIN
  SELECT vi.id, vi.empresa_id, vi.status, vi.completion_date, vi.work_order_id,
         wo.os_number, coalesce(wo.eh_teste, false) AS eh_teste, wo.deleted_at
    INTO v
    FROM public.visits vi JOIN public.work_orders wo ON wo.id = vi.work_order_id
   WHERE vi.id = _visita;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT coalesce(sum(si.repasse_parceiro), 0),
         string_agg(DISTINCT t.name, ', ')
    INTO total, parceiros
    FROM public.service_items si LEFT JOIN public.technicians t ON t.id = si.parceiro_id
   WHERE si.visit_id = _visita AND si.active AND si.repasse_parceiro > 0;

  UPDATE public.visits SET repasse_parceiro = total
   WHERE id = _visita AND repasse_parceiro IS DISTINCT FROM total;
  -- Comissão da OS pelo valor líquido (repasse mudou ou há repasse no atendimento).
  IF FOUND OR total > 0 THEN
    PERFORM private.recalcular_comissao_os(v.work_order_id);
  END IF;

  SELECT * INTO atual FROM public.expenses
   WHERE empresa_id = v.empresa_id AND reference_key = chave AND deleted_at IS NULL;

  IF v.status = 'Concluído' AND total > 0 AND NOT v.eh_teste AND v.deleted_at IS NULL THEN
    IF atual.id IS NULL THEN
      INSERT INTO public.expenses (
        empresa_id, description, category, competence_date, due_date, expected_amount,
        status, origin, beneficiary, work_order_id, reference_key, notes)
      VALUES (
        v.empresa_id, 'Repasse a parceiro — OS ' || v.os_number, 'Repasse a parceiro',
        coalesce(v.completion_date, current_date), coalesce(v.completion_date, current_date),
        total, 'Pendente', 'Repasse a parceiro', parceiros, v.work_order_id, chave,
        'Criada ao concluir o atendimento (itens terceirizados).');
    ELSIF coalesce(atual.paid_amount, 0) = 0 AND atual.status <> 'Pago' THEN
      UPDATE public.expenses
         SET expected_amount = total,
             competence_date = coalesce(v.completion_date, competence_date),
             due_date = coalesce(v.completion_date, due_date),
             beneficiary = parceiros,
             status = 'Pendente',
             updated_at = now()
       WHERE id = atual.id;
    END IF;
  ELSIF atual.id IS NOT NULL AND coalesce(atual.paid_amount, 0) = 0
        AND atual.status NOT IN ('Pago', 'Cancelado') THEN
    UPDATE public.expenses
       SET status = 'Cancelado',
           notes = coalesce(notes || ' ', '') || 'Cancelada: atendimento não concluído ou sem repasse.',
           updated_at = now()
     WHERE id = atual.id;
  END IF;
END $$;
