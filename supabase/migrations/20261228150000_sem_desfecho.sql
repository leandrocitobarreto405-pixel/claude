-- "Orçamentos sem desfecho" (item E, aprovado em 27/10/2026): lead com orçamento enviado e sem OS
-- entra na aba quando a Trilha A termina sem resposta, quando a Alice registra um motivo (sugestão)
-- ou quando passa a validade do orçamento + 2 dias. A equipe confirma o motivo com um clique
-- (loss_reason_id, motivos por empresa em config_options). Lead com OS sai sozinho (ganho).
-- Só colunas, motivos e funções novas; os motivos antigos continuam onde estão.

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS sem_desfecho_sugerido text,
  ADD COLUMN IF NOT EXISTS data_desejada date,
  ADD COLUMN IF NOT EXISTS desfecho_obs text,
  ADD COLUMN IF NOT EXISTS desfecho_em timestamptz,
  ADD COLUMN IF NOT EXISTS desfecho_por uuid;
CREATE INDEX IF NOT EXISTS idx_crm_leads_desfecho ON public.crm_leads (empresa_id, desfecho_em)
  WHERE desfecho_em IS NOT NULL;

-- Os 11 motivos (editáveis por empresa em Configurações › Listas). metadata.sem_desfecho marca
-- os que aparecem na aba; pede_data: 'desejada' (agenda cheia) ou 'retorno' (adiou);
-- nao_conta: fora do relatório de perdas (duplicado/teste).
CREATE OR REPLACE FUNCTION private.garantir_motivos_sem_desfecho(_emp uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.config_options (empresa_id, kind, name, display_order, active, metadata)
  SELECT _emp, 'crm_loss_reason', m.nome, 100 + m.ordem, true,
         jsonb_build_object('sem_desfecho', true, 'ordem', m.ordem) || m.extra
    FROM (VALUES
      (1, 'Agenda cheia', '{"pede_data": "desejada"}'::jsonb),
      (2, 'Preço alto – fechou com outra empresa', '{}'::jsonb),
      (3, 'Preço alto – desistiu/adiou', '{}'::jsonb),
      (4, 'Fechou com outra empresa (motivo não informado)', '{}'::jsonb),
      (5, 'Não respondeu depois dos follow-ups', '{}'::jsonb),
      (6, 'Adiou', '{"pede_data": "retorno", "adiou": true}'::jsonb),
      (7, 'Fora da área', '{}'::jsonb),
      (8, 'Não precisa mais', '{}'::jsonb),
      (9, 'Só cotando', '{}'::jsonb),
      (10, 'Serviço que não fazemos', '{}'::jsonb),
      (11, 'Duplicado/teste', '{"nao_conta": true}'::jsonb)
    ) AS m(ordem, nome, extra)
   WHERE NOT EXISTS (SELECT 1 FROM public.config_options o
                      WHERE o.empresa_id = _emp AND o.kind = 'crm_loss_reason'
                        AND (o.metadata->>'sem_desfecho')::boolean IS TRUE);
$$;
REVOKE ALL ON FUNCTION private.garantir_motivos_sem_desfecho(uuid) FROM PUBLIC, anon, authenticated;
SELECT private.garantir_motivos_sem_desfecho(e.id) FROM public.empresas e;

-- Leads esperando o motivo (empresa ativa).
CREATE OR REPLACE FUNCTION public.leads_sem_desfecho()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid := private.empresa_ativa();
  validade int;
BEGIN
  IF emp IS NULL OR NOT (private.tem_papel('admin') OR private.tem_papel('atendente')) THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(validade_dias, 7) INTO validade FROM public.orcamento_configuracoes WHERE empresa_id = emp;
  validade := coalesce(validade, 7);
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'enviado_em')
      FROM (
        SELECT jsonb_build_object(
          'id', l.id,
          'nome', l.lead_name,
          'servico', coalesce(q.servicos, l.service_interest),
          'valor', q.total,
          'enviado_em', l.orcamento_enviado_em,
          'origem', o.name,
          'resumo', l.summary,
          'sugerido', coalesce(l.sem_desfecho_sugerido, l.sem_desfecho_motivo),
          'data_desejada', l.data_desejada,
          'entrou', CASE WHEN l.sem_desfecho_em IS NOT NULL THEN 'cadencia' ELSE 'validade' END,
          'conversa_id', (SELECT c.id FROM public.conversas c WHERE c.crm_lead_id = l.id
                           ORDER BY c.ultima_atividade_em DESC NULLS LAST LIMIT 1)) AS x
          FROM public.crm_leads l
          LEFT JOIN public.config_options o ON o.id = l.sales_origin_id
          LEFT JOIN LATERAL (
            SELECT coalesce(qq.total, qq.valor_cartao) AS total,
                   (SELECT string_agg(DISTINCT qi.nome_snapshot, ', ') FROM public.quote_items qi WHERE qi.quote_id = qq.id) AS servicos
              FROM public.quotes qq WHERE qq.crm_lead_id = l.id
             ORDER BY qq.created_at DESC LIMIT 1) q ON true
         WHERE l.empresa_id = emp
           AND l.orcamento_enviado_em IS NOT NULL
           AND l.os_criada_em IS NULL AND l.linked_work_order_id IS NULL
           AND l.loss_reason_id IS NULL AND l.perdido_em IS NULL AND l.desfecho_em IS NULL
           AND coalesce(l.is_open, true)
           AND (l.next_follow_up_at IS NULL OR l.next_follow_up_at < now())
           AND (l.sem_desfecho_em IS NOT NULL
                OR (l.orcamento_enviado_em AT TIME ZONE 'America/Sao_Paulo')::date + validade + 2
                   < (now() AT TIME ZONE 'America/Sao_Paulo')::date)) s), '[]'::jsonb);
END $$;

-- Motivos da aba (empresa ativa), criando os padrões se faltarem.
CREATE OR REPLACE FUNCTION public.motivos_sem_desfecho()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE emp uuid := private.empresa_ativa();
BEGIN
  IF emp IS NULL OR NOT (private.tem_papel('admin') OR private.tem_papel('atendente')) THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  PERFORM private.garantir_motivos_sem_desfecho(emp);
  RETURN (SELECT jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.name,
                   'pede_data', o.metadata->>'pede_data', 'adiou', coalesce((o.metadata->>'adiou')::boolean, false),
                   'nao_conta', coalesce((o.metadata->>'nao_conta')::boolean, false))
                   ORDER BY o.display_order, o.name)
            FROM public.config_options o
           WHERE o.empresa_id = emp AND o.kind = 'crm_loss_reason' AND o.active
             AND (o.metadata->>'sem_desfecho')::boolean IS TRUE);
END $$;

-- Um clique: grava o motivo. "Adiou" volta para o follow-up na data; os outros encerram o lead.
CREATE OR REPLACE FUNCTION public.registrar_desfecho(_lead uuid, _motivo uuid, _obs text DEFAULT NULL,
                                                     _data date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid := private.empresa_ativa();
  m public.config_options;
  l public.crm_leads;
  perdido uuid;
  conversa uuid;
BEGIN
  IF emp IS NULL OR NOT (private.tem_papel('admin') OR private.tem_papel('atendente')) THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = _lead AND empresa_id = emp FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Lead não encontrado.'; END IF;
  SELECT * INTO m FROM public.config_options
   WHERE id = _motivo AND empresa_id = emp AND kind = 'crm_loss_reason';
  IF m.id IS NULL THEN RAISE EXCEPTION 'Motivo inválido.'; END IF;
  IF m.metadata->>'pede_data' = 'retorno' AND (_data IS NULL OR _data < (now() AT TIME ZONE 'America/Sao_Paulo')::date) THEN
    RAISE EXCEPTION 'Informe a data para voltar a falar com o cliente.';
  END IF;
  SELECT c.id INTO conversa FROM public.conversas c WHERE c.crm_lead_id = l.id
   ORDER BY c.ultima_atividade_em DESC NULLS LAST LIMIT 1;

  IF coalesce((m.metadata->>'adiou')::boolean, false) THEN
    UPDATE public.crm_leads
       SET next_follow_up_at = (_data + time '10:00') AT TIME ZONE 'America/Sao_Paulo',
           sem_desfecho_em = NULL, sem_desfecho_sugerido = NULL,
           desfecho_obs = nullif(trim(_obs), '')
     WHERE id = l.id;
    INSERT INTO public.crm_followups (empresa_id, crm_lead_id, conversa_id, scheduled_at, responsavel, notes)
    VALUES (emp, l.id, conversa, (_data + time '10:00') AT TIME ZONE 'America/Sao_Paulo', 'equipe',
            'Adiou: retomar o orçamento' || coalesce(' — ' || nullif(trim(_obs), ''), ''));
    RETURN jsonb_build_object('resultado', 'adiou', 'data', _data);
  END IF;

  SELECT o.id INTO perdido FROM public.config_options o
   WHERE o.empresa_id = emp AND o.kind = 'crm_status' AND o.active
     AND (o.metadata->>'lost')::boolean IS TRUE
   ORDER BY o.display_order LIMIT 1;
  UPDATE public.crm_leads
     SET loss_reason_id = m.id,
         status_id = coalesce(perdido, status_id),
         perdido_em = coalesce(perdido_em, now()),
         is_open = false,
         closed_at = coalesce(closed_at, now()),
         next_follow_up_at = NULL,
         data_desejada = CASE WHEN m.metadata->>'pede_data' = 'desejada' THEN coalesce(_data, data_desejada) ELSE data_desejada END,
         desfecho_obs = nullif(trim(_obs), ''),
         desfecho_em = now(),
         desfecho_por = auth.uid()
   WHERE id = l.id;
  IF conversa IS NOT NULL THEN
    PERFORM private.ia_cancelar_followups(conversa, 'sem desfecho: ' || m.name);
  END IF;
  RETURN jsonb_build_object('resultado', 'registrado', 'motivo', m.name);
END $$;

-- Relatório "Perdas por motivo" no período (quantidade e R$), com filtro de origem e serviço.
CREATE OR REPLACE FUNCTION public.perdas_por_motivo(_de date, _ate date, _origem uuid DEFAULT NULL,
                                                    _servico text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE emp uuid := private.empresa_ativa();
BEGIN
  IF emp IS NULL OR NOT (private.tem_papel('admin') OR private.tem_papel('atendente')) THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH base AS (
      SELECT l.id, o.name AS motivo, coalesce((o.metadata->>'nao_conta')::boolean, false) AS nao_conta,
             o.display_order, coalesce(q.total, 0) AS valor, coalesce(q.servicos, l.service_interest, 'Sem serviço') AS servico,
             CASE WHEN l.data_desejada IS NOT NULL
                  THEN l.data_desejada - (coalesce(l.desfecho_em, l.perdido_em) AT TIME ZONE 'America/Sao_Paulo')::date END AS dias_frente
        FROM public.crm_leads l
        JOIN public.config_options o ON o.id = l.loss_reason_id
        LEFT JOIN LATERAL (
          SELECT coalesce(qq.total, qq.valor_cartao) AS total,
                 (SELECT string_agg(DISTINCT qi.tipo_servico::text, ', ') FROM public.quote_items qi WHERE qi.quote_id = qq.id) AS servicos
            FROM public.quotes qq WHERE qq.crm_lead_id = l.id ORDER BY qq.created_at DESC LIMIT 1) q ON true
       WHERE l.empresa_id = emp
         AND (coalesce(l.desfecho_em, l.perdido_em) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _de AND _ate
         AND (_origem IS NULL OR l.sales_origin_id = _origem)
         AND (_servico IS NULL OR coalesce(q.servicos, l.service_interest, '') ILIKE '%' || _servico || '%'))
    SELECT jsonb_build_object(
      'motivos', coalesce((SELECT jsonb_agg(jsonb_build_object('motivo', motivo, 'quantidade', n, 'valor', v, 'nao_conta', nao_conta) ORDER BY nao_conta, v DESC, n DESC)
                            FROM (SELECT motivo, nao_conta, count(*) AS n, sum(valor) AS v FROM base GROUP BY motivo, nao_conta) m), '[]'::jsonb),
      'total', jsonb_build_object('quantidade', (SELECT count(*) FROM base WHERE NOT nao_conta),
                                  'valor', (SELECT coalesce(sum(valor), 0) FROM base WHERE NOT nao_conta)),
      'agenda_cheia', coalesce((SELECT jsonb_agg(jsonb_build_object('servico', servico, 'quantidade', n, 'valor', v, 'dias_frente_media', d) ORDER BY n DESC)
                                 FROM (SELECT servico, count(*) AS n, sum(valor) AS v, round(avg(dias_frente)) AS d
                                         FROM base WHERE motivo = 'Agenda cheia' GROUP BY servico) a), '[]'::jsonb))
  );
END $$;

-- Contagem para o aviso ("X orçamentos esperando o motivo").
CREATE OR REPLACE FUNCTION public.contar_sem_desfecho()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN private.empresa_ativa() IS NULL OR NOT (private.tem_papel('admin') OR private.tem_papel('atendente'))
              THEN 0 ELSE jsonb_array_length(public.leads_sem_desfecho()) END;
$$;

REVOKE ALL ON FUNCTION public.leads_sem_desfecho(), public.motivos_sem_desfecho(),
  public.registrar_desfecho(uuid, uuid, text, date), public.perdas_por_motivo(date, date, uuid, text),
  public.contar_sem_desfecho() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leads_sem_desfecho(), public.motivos_sem_desfecho(),
  public.registrar_desfecho(uuid, uuid, text, date), public.perdas_por_motivo(date, date, uuid, text),
  public.contar_sem_desfecho() TO authenticated;
