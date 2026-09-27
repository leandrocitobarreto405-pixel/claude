-- =====================================================================================
-- Nexa OS — Etapa 4: funil e indicadores
--
--  * Orçamento passa a ter lead (quotes.crm_lead_id). Sem lead informado, o orçamento é ligado
--    ao lead ABERTO com o mesmo telefone.
--  * Marcos no lead, calculados a partir dos fatos do sistema (não dependem de alguém mudar o
--    status à mão): orçamento criado/enviado/aprovado, OS criada, agendado, realizado, faturado,
--    perdido. A primeira resposta já vem do Chatwoot (Etapa 3).
--  * Orçamento de um lead que vira OS converte o lead (mesma regra da tela "Nova OS").
--  * Etapa canônica (igual para todas as empresas): public.etapa(crm_leads), campo calculado.
--  * public.indicadores_funil(de, ate): funil por coorte de leads e números do período.
-- =====================================================================================

-- ---------------------------------------------------------------- vínculo orçamento → lead
ALTER TABLE public.quotes ADD COLUMN crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL;
CREATE INDEX idx_quotes_lead ON public.quotes (crm_lead_id);

DROP TRIGGER trg_quotes_valida_empresa ON public.quotes;
CREATE TRIGGER trg_quotes_valida_empresa BEFORE INSERT OR UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'crm_lead_id', 'crm_leads', 'customer_id', 'customers', 'generated_work_order_id', 'work_orders');

-- ---------------------------------------------------------------- marcos no lead
ALTER TABLE public.crm_leads
  ADD COLUMN orcamento_em timestamptz,
  ADD COLUMN orcamento_enviado_em timestamptz,
  ADD COLUMN orcamento_aprovado_em timestamptz,
  ADD COLUMN os_criada_em timestamptz,
  ADD COLUMN agendado_em timestamptz,
  ADD COLUMN realizado_em timestamptz,
  ADD COLUMN faturado_em timestamptz,
  ADD COLUMN perdido_em timestamptz;
CREATE INDEX idx_crm_leads_empresa_contato ON public.crm_leads (empresa_id, first_contact_date);
CREATE INDEX idx_crm_leads_os ON public.crm_leads (linked_work_order_id);

-- Recalcula os marcos derivados de orçamentos, OS, atendimentos e pagamentos. Idempotente.
-- Os marcos "enviado" e "aprovado" guardam a primeira vez em que o fato foi visto.
CREATE OR REPLACE FUNCTION private.atualizar_marcos_lead(_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.crm_leads;
  v_orcamento timestamptz;
  v_enviado timestamptz;
  v_aprovado timestamptz;
  v_os timestamptz;
  v_agendado timestamptz;
  v_realizado timestamptz;
  v_faturado timestamptz;
BEGIN
  IF _lead_id IS NULL THEN RETURN; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = _lead_id;
  IF l.id IS NULL THEN RETURN; END IF;

  SELECT min(q.created_at),
         CASE WHEN bool_or(q.status IN ('enviado', 'aprovado', 'recusado', 'convertido'))
              THEN coalesce(l.orcamento_enviado_em, now()) END,
         CASE WHEN bool_or(q.status IN ('aprovado', 'convertido'))
              THEN coalesce(l.orcamento_aprovado_em, now()) END
    INTO v_orcamento, v_enviado, v_aprovado
    FROM public.quotes q
   WHERE q.crm_lead_id = l.id AND q.empresa_id = l.empresa_id;

  IF l.linked_work_order_id IS NOT NULL THEN
    SELECT w.created_at INTO v_os FROM public.work_orders w
     WHERE w.id = l.linked_work_order_id AND w.empresa_id = l.empresa_id AND w.deleted_at IS NULL;
  END IF;

  IF v_os IS NOT NULL THEN
    SELECT min(v.created_at) FILTER (WHERE v.status IS DISTINCT FROM 'Cancelado'),
           min(coalesce((v.completion_date + coalesce(v.completion_time, time '12:00'))
                          AT TIME ZONE 'America/Sao_Paulo', v.updated_at))
             FILTER (WHERE v.status = 'Concluído')
      INTO v_agendado, v_realizado
      FROM public.visits v
     WHERE v.work_order_id = l.linked_work_order_id AND v.empresa_id = l.empresa_id;

    SELECT min((p.payment_date + time '12:00') AT TIME ZONE 'America/Sao_Paulo')
      INTO v_faturado
      FROM public.payments p
     WHERE p.work_order_id = l.linked_work_order_id AND p.empresa_id = l.empresa_id
       AND p.is_active AND p.payment_status = 'Pago';
  END IF;

  IF (l.orcamento_em, l.orcamento_enviado_em, l.orcamento_aprovado_em, l.os_criada_em,
      l.agendado_em, l.realizado_em, l.faturado_em)
     IS DISTINCT FROM (v_orcamento, v_enviado, v_aprovado, v_os, v_agendado, v_realizado, v_faturado)
  THEN
    UPDATE public.crm_leads
       SET orcamento_em = v_orcamento, orcamento_enviado_em = v_enviado,
           orcamento_aprovado_em = v_aprovado, os_criada_em = v_os, agendado_em = v_agendado,
           realizado_em = v_realizado, faturado_em = v_faturado
     WHERE id = l.id;
  END IF;
END $$;

-- Converte o lead ao virar OS (mesma regra de linkLeadToWorkOrder no app): vincula a OS, encerra
-- o lead e aplica o primeiro status "fechado e não perdido" da empresa.
CREATE OR REPLACE FUNCTION private.converter_lead_em_os(_lead_id uuid, _work_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.crm_leads;
  convertido public.config_options;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = _lead_id FOR UPDATE;
  IF l.id IS NULL OR l.linked_work_order_id IS NOT NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_orders WHERE id = _work_order_id AND empresa_id = l.empresa_id) THEN
    RETURN;
  END IF;

  SELECT * INTO convertido FROM public.config_options
   WHERE empresa_id = l.empresa_id AND kind = 'crm_status' AND active
     AND coalesce((metadata->>'closed')::boolean, false)
     AND NOT coalesce((metadata->>'lost')::boolean, false)
   ORDER BY display_order, name LIMIT 1;

  UPDATE public.crm_leads
     SET linked_work_order_id = _work_order_id, is_open = false,
         closed_at = coalesce(closed_at, now()), last_interaction_at = now(),
         next_follow_up_at = NULL, status_id = coalesce(convertido.id, status_id)
   WHERE id = l.id;

  IF convertido.id IS NOT NULL AND l.status_id IS DISTINCT FROM convertido.id THEN
    INSERT INTO public.crm_status_history (empresa_id, crm_lead_id, previous_status_id, new_status_id,
      previous_status_name, new_status_name, changed_by, change_source, notes)
    VALUES (l.empresa_id, l.id, l.status_id, convertido.id,
      (SELECT name FROM public.config_options WHERE id = l.status_id), convertido.name,
      auth.uid(), 'Orçamento', 'Lead convertido em OS a partir do orçamento.');
  END IF;
END $$;

-- ---------------------------------------------------------------- gatilhos
-- Orçamento sem lead: liga ao lead aberto mais recente com o mesmo telefone.
CREATE OR REPLACE FUNCTION private.quotes_ligar_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fone text;
BEGIN
  IF NEW.crm_lead_id IS NULL AND NEW.cliente_telefone IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.cliente_telefone IS DISTINCT FROM OLD.cliente_telefone) THEN
    fone := private.normalizar_telefone(NEW.cliente_telefone);
    SELECT id INTO NEW.crm_lead_id FROM public.crm_leads
     WHERE empresa_id = NEW.empresa_id AND is_open AND normalized_phone = fone
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
-- Nome em ordem alfabética antes de trg_quotes_valida_empresa (gatilhos BEFORE rodam por nome).
CREATE TRIGGER trg_quotes_lead_auto BEFORE INSERT OR UPDATE OF cliente_telefone, crm_lead_id
  ON public.quotes FOR EACH ROW EXECUTE FUNCTION private.quotes_ligar_lead();

CREATE OR REPLACE FUNCTION private.quotes_marcos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.atualizar_marcos_lead(OLD.crm_lead_id);
    RETURN NULL;
  END IF;
  IF NEW.crm_lead_id IS NOT NULL AND NEW.generated_work_order_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM private.converter_lead_em_os(NEW.crm_lead_id, NEW.generated_work_order_id);
    ELSIF OLD.generated_work_order_id IS DISTINCT FROM NEW.generated_work_order_id
       OR OLD.crm_lead_id IS DISTINCT FROM NEW.crm_lead_id THEN
      PERFORM private.converter_lead_em_os(NEW.crm_lead_id, NEW.generated_work_order_id);
    END IF;
  END IF;
  PERFORM private.atualizar_marcos_lead(NEW.crm_lead_id);
  IF TG_OP = 'UPDATE' THEN
    IF OLD.crm_lead_id IS DISTINCT FROM NEW.crm_lead_id THEN
      PERFORM private.atualizar_marcos_lead(OLD.crm_lead_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_quotes_marcos AFTER INSERT OR UPDATE OF status, crm_lead_id, generated_work_order_id OR DELETE
  ON public.quotes FOR EACH ROW EXECUTE FUNCTION private.quotes_marcos();

-- Lead: perdido quando encerrado com motivo de perda ou status "perdido"; OS vinculada recalcula.
CREATE OR REPLACE FUNCTION private.crm_leads_perdido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT NEW.is_open AND NEW.linked_work_order_id IS NULL AND (
       NEW.loss_reason_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.config_options
                   WHERE id = NEW.status_id AND coalesce((metadata->>'lost')::boolean, false))) THEN
    NEW.perdido_em := coalesce(NEW.perdido_em, NEW.closed_at, now());
  ELSE
    NEW.perdido_em := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_crm_leads_perdido BEFORE INSERT OR UPDATE OF is_open, status_id, loss_reason_id, linked_work_order_id
  ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION private.crm_leads_perdido();

CREATE OR REPLACE FUNCTION private.crm_leads_marcos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.atualizar_marcos_lead(NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_crm_leads_marcos AFTER INSERT OR UPDATE OF linked_work_order_id
  ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION private.crm_leads_marcos();

-- OS, atendimentos e pagamentos recalculam os leads ligados à OS.
CREATE OR REPLACE FUNCTION private.os_marcos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  os_ids uuid[] := '{}';
  lead uuid;
BEGIN
  IF TG_TABLE_NAME = 'work_orders' THEN
    os_ids := ARRAY[NEW.id];
  ELSE
    IF TG_OP IN ('UPDATE', 'DELETE') THEN os_ids := os_ids || OLD.work_order_id; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN os_ids := os_ids || NEW.work_order_id; END IF;
  END IF;
  FOR lead IN SELECT id FROM public.crm_leads WHERE linked_work_order_id = ANY (os_ids) LOOP
    PERFORM private.atualizar_marcos_lead(lead);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_work_orders_marcos AFTER UPDATE OF deleted_at
  ON public.work_orders FOR EACH ROW EXECUTE FUNCTION private.os_marcos();
CREATE TRIGGER trg_visits_marcos AFTER INSERT OR DELETE OR UPDATE OF status, completion_date, completion_time, work_order_id
  ON public.visits FOR EACH ROW EXECUTE FUNCTION private.os_marcos();
CREATE TRIGGER trg_payments_marcos AFTER INSERT OR DELETE OR UPDATE OF payment_status, is_active, payment_date, work_order_id
  ON public.payments FOR EACH ROW EXECUTE FUNCTION private.os_marcos();

REVOKE ALL ON FUNCTION private.atualizar_marcos_lead(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.converter_lead_em_os(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- etapa canônica
-- Campo calculado: select=*,etapa na API. Igual para todas as empresas; os status personalizados
-- continuam existindo para o dia a dia.
CREATE OR REPLACE FUNCTION public.etapa(public.crm_leads)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN $1.faturado_em IS NOT NULL THEN 'faturado'
    WHEN $1.realizado_em IS NOT NULL THEN 'realizado'
    WHEN $1.agendado_em IS NOT NULL THEN 'agendado'
    WHEN $1.os_criada_em IS NOT NULL THEN 'os_criada'
    WHEN $1.perdido_em IS NOT NULL THEN 'perdido'
    WHEN $1.orcamento_aprovado_em IS NOT NULL THEN 'orcamento_aprovado'
    WHEN $1.orcamento_enviado_em IS NOT NULL THEN 'orcamento_enviado'
    WHEN $1.orcamento_em IS NOT NULL THEN 'orcamento'
    WHEN NOT $1.is_open THEN 'encerrado'
    WHEN $1.primeira_resposta_em IS NOT NULL
      OR (SELECT metadata->>'stage' FROM public.config_options WHERE id = $1.status_id)
         IN ('atendimento', 'negociacao', 'orcamento', 'aguardando', 'repescar') THEN 'em_atendimento'
    ELSE 'novo'
  END;
$$;
GRANT EXECUTE ON FUNCTION public.etapa(public.crm_leads) TO authenticated, service_role;

-- ---------------------------------------------------------------- indicadores
-- Roda com as permissões de quem chama: cada empresa só enxerga os próprios números.
-- Funil = coorte de leads com primeiro contato no período, acompanhados até hoje.
-- "periodo" = fatos que aconteceram no período (orçamentos, OS, recebimentos).
CREATE OR REPLACE FUNCTION public.indicadores_funil(_de date, _ate date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH coorte AS (
    SELECT l.*, public.etapa(l) AS etapa_atual,
           EXISTS (SELECT 1 FROM public.conversas c WHERE c.crm_lead_id = l.id) AS tem_conversa
      FROM public.crm_leads l
     WHERE l.first_contact_date BETWEEN _de AND _ate
  ),
  resposta AS (
    SELECT extract(epoch FROM (primeira_resposta_em - created_at)) / 60 AS minutos
      FROM coorte WHERE tem_conversa AND primeira_resposta_em IS NOT NULL
  ),
  os_coorte AS (
    SELECT DISTINCT w.id, w.total_gross_value
      FROM coorte l JOIN public.work_orders w ON w.id = l.linked_work_order_id
     WHERE w.deleted_at IS NULL AND w.status IS DISTINCT FROM 'Cancelada'
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
  ),
  pag_periodo AS (
    SELECT * FROM public.payments
     WHERE payment_date BETWEEN _de AND _ate AND is_active AND payment_status = 'Pago'
  ),
  origens AS (
    SELECT coalesce(o.name, l.source_type, 'Sem origem') AS origem,
           count(*) AS leads,
           count(*) FILTER (WHERE l.orcamento_em IS NOT NULL) AS orcamentos,
           count(*) FILTER (WHERE l.os_criada_em IS NOT NULL) AS vendas,
           coalesce(sum(w.total_gross_value) FILTER (WHERE w.deleted_at IS NULL
             AND w.status IS DISTINCT FROM 'Cancelada'), 0) AS vendido
      FROM coorte l
      LEFT JOIN public.config_options o ON o.id = l.sales_origin_id
      LEFT JOIN public.work_orders w ON w.id = l.linked_work_order_id
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('de', _de, 'ate', _ate),
    'funil', (SELECT jsonb_build_object(
        'leads', count(*),
        'atendidos', count(*) FILTER (WHERE primeira_resposta_em IS NOT NULL
                                        OR etapa_atual NOT IN ('novo', 'encerrado', 'perdido')),
        'orcamento', count(*) FILTER (WHERE orcamento_em IS NOT NULL),
        'orcamento_enviado', count(*) FILTER (WHERE orcamento_enviado_em IS NOT NULL),
        'orcamento_aprovado', count(*) FILTER (WHERE orcamento_aprovado_em IS NOT NULL OR os_criada_em IS NOT NULL),
        'os_criada', count(*) FILTER (WHERE os_criada_em IS NOT NULL),
        'agendado', count(*) FILTER (WHERE agendado_em IS NOT NULL),
        'realizado', count(*) FILTER (WHERE realizado_em IS NOT NULL),
        'faturado', count(*) FILTER (WHERE faturado_em IS NOT NULL),
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
REVOKE ALL ON FUNCTION public.indicadores_funil(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.indicadores_funil(date, date) TO authenticated, service_role;
