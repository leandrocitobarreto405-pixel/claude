-- Marketing: ninguém que já é cliente (OS recente ou em aberto) ou tem garantia/reclamação em
-- aberto recebe campanha, promoção ou lembrete (aprovado em 15/10/2026).
--  * mkt_listas_dados ganha tem_os e garantia_aberta (a anterior é renomeada, não apagada, porque
--    ganhou colunas; as chamadas continuam iguais).
--  * mkt_motivo_fora ganha dois parâmetros com padrão (a de 8 parâmetros é renomeada; chamadas
--    antigas continuam valendo): "garantia/reclamação em aberto" e "tem OS".
--  * Listas (tela, promoção, planilha), preparação, contagem e "presas" das campanhas e lembretes
--    passam a aplicar as duas regras ("tem OS" só tira de conversa, orçamento e promoção).
--  * mkt_reservar_envios cancela, antes de reservar, o envio pendente de quem passou a ter OS
--    (campanha e promoção) ou garantia em aberto (tudo, inclusive lembretes).
--  * Aviso só no app quando um serviço de data passada continua "Agendado" depois de 1 dia.
-- Nada é apagado: envios cancelados ficam com o motivo em `erro`.

-- ---------------------------------------------------------------- regras novas (por contato)
-- OS do mesmo cliente (cadastro ligado ou mesmo telefone), não cancelada, não excluída e não de
-- teste, com venda nos últimos 90 dias OU com algum atendimento ainda não concluído (qualquer data).
CREATE OR REPLACE FUNCTION private.mkt_contato_tem_os(_contato uuid, _hoje date DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (
    SELECT id, empresa_id, customer_id, private.telefone_chave(normalized_phone) AS chave
      FROM public.mkt_contatos WHERE id = _contato
  ), p AS (SELECT coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS hoje)
  SELECT EXISTS (
    SELECT 1
      FROM c, p, public.work_orders w
      LEFT JOIN public.customers cu ON cu.id = w.customer_id
     WHERE w.empresa_id = c.empresa_id AND w.deleted_at IS NULL AND NOT w.eh_teste
       AND w.status IS DISTINCT FROM 'Cancelada'
       AND ((c.customer_id IS NOT NULL AND w.customer_id = c.customer_id)
            OR (c.chave IS NOT NULL AND private.telefone_chave(private.normalizar_telefone(cu.phone)) = c.chave))
       AND (w.sale_date >= p.hoje - 90
            OR EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.work_order_id = w.id AND v.status IN ('Agendado', 'Reagendado', 'Em execução'))));
$$;
REVOKE ALL ON FUNCTION private.mkt_contato_tem_os(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mkt_contato_tem_os(uuid, date) TO service_role;

-- Retorno pendente de garantia ou reclamação em lead do mesmo telefone (a regra que a Alice usa
-- para não mandar pós-venda).
CREATE OR REPLACE FUNCTION private.mkt_contato_garantia_aberta(_contato uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (
    SELECT id, empresa_id, crm_lead_id, private.telefone_chave(normalized_phone) AS chave
      FROM public.mkt_contatos WHERE id = _contato
  )
  SELECT EXISTS (
    SELECT 1
      FROM c
      JOIN public.crm_leads l ON l.empresa_id = c.empresa_id
       AND (l.id = c.crm_lead_id OR (c.chave IS NOT NULL AND private.telefone_chave(l.normalized_phone) = c.chave))
      JOIN public.crm_followups f ON f.crm_lead_id = l.id AND f.status = 'Pendente'
     WHERE f.notes ILIKE '%garantia%' OR f.notes ILIKE '%reclama%');
$$;
REVOKE ALL ON FUNCTION private.mkt_contato_garantia_aberta(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mkt_contato_garantia_aberta(uuid) TO service_role;

-- ---------------------------------------------------------------- listas com as colunas novas
-- Não apaga a versão anterior: renomeia (fica guardada) e cria a nova com o mesmo nome.
ALTER FUNCTION private.mkt_listas_dados(uuid, date) RENAME TO mkt_listas_dados_ate_20261112;
CREATE FUNCTION private.mkt_listas_dados(_emp uuid, _hoje date DEFAULT NULL)
RETURNS TABLE (
  contato_id uuid, nome text, primeiro_nome text, telefone text,
  cliente_em timestamptz, servico_tipo text,
  orcamento_em timestamptz, orcamento_valor numeric, orcamento_a_vista numeric, orcamento_km numeric,
  conversa_em timestamptz, perdido_preco_em timestamptz, agendado_para date,
  em_orcamento boolean, em_conversa boolean,
  dias_cliente int, dias_orcamento int, dias_conversa int,
  endereco text, cep text, latitude double precision, longitude double precision,
  optout boolean, interno boolean, sem_pos_venda boolean, ultimo_marketing_em timestamptz,
  tem_os boolean, garantia_aberta boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH params AS (
    SELECT coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS hoje
  ), base AS (
    SELECT c.*, private.telefone_chave(c.normalized_phone) AS chave
      FROM public.mkt_contatos c WHERE c.empresa_id = _emp
  ), dados AS (
    SELECT b.*, p.hoje,
      l.id AS lead_id, l.realizado_em, l.perdido_em, l.last_interaction_at, l.primeira_mensagem_em,
      l.created_at AS lead_criado_em, l.orcamento_em AS lead_orcamento_em,
      l.orcamento_enviado_em AS lead_orcamento_enviado_em, lower(btrim(r.name)) AS motivo_perda,
      q.created_at AS quote_em, q.total AS quote_total, q.valor_a_vista AS quote_a_vista,
      q.km_ida_volta AS quote_km, q.cliente_endereco AS quote_endereco, q.cliente_cep AS quote_cep,
      cu.full_address AS cliente_endereco, cu.postal_code AS cliente_cep,
      cu.latitude AS cliente_lat, cu.longitude AS cliente_lon,
      ag.proxima AS agendado_para,
      -- Último marketing: envio de campanha/promoção ou "já chamei manualmente" (o que for depois).
      greatest(mk.ultimo, (b.chamado_manual_em::timestamp AT TIME ZONE 'America/Sao_Paulo')) AS ultimo_marketing_em
    FROM base b
    CROSS JOIN params p
    LEFT JOIN LATERAL (
      SELECT x.* FROM public.crm_leads x
       WHERE x.empresa_id = _emp
         AND (x.id = b.crm_lead_id OR private.telefone_chave(x.normalized_phone) = b.chave)
       ORDER BY (x.id = b.crm_lead_id) DESC, x.updated_at DESC NULLS LAST LIMIT 1
    ) l ON true
    LEFT JOIN public.config_options r ON r.id = l.loss_reason_id
    LEFT JOIN LATERAL (
      SELECT y.* FROM public.quotes y
       WHERE y.empresa_id = _emp
         AND y.status IN ('rascunho', 'enviado', 'aprovado') AND y.generated_work_order_id IS NULL
         AND ((l.id IS NOT NULL AND y.crm_lead_id = l.id)
              OR private.telefone_chave(private.normalizar_telefone(y.cliente_telefone)) = b.chave)
       ORDER BY y.created_at DESC LIMIT 1
    ) q ON true
    LEFT JOIN public.customers cu ON cu.id = b.customer_id
    LEFT JOIN LATERAL (
      SELECT min(v.scheduled_date) AS proxima
        FROM public.visits v
        JOIN public.work_orders w ON w.id = v.work_order_id
        LEFT JOIN public.customers vc ON vc.id = w.customer_id
       WHERE v.empresa_id = _emp AND v.scheduled_date >= p.hoje
         AND v.status IN ('Agendado', 'Em execução', 'Reagendado')
         AND (w.customer_id = b.customer_id
              OR private.telefone_chave(private.normalizar_telefone(vc.phone)) = b.chave)
    ) ag ON true
    LEFT JOIN LATERAL (
      SELECT max(coalesce(e.enviado_em, e.agendado_para, e.created_at)) AS ultimo
        FROM public.mkt_envios e JOIN public.mkt_campanhas k ON k.id = e.campanha_id
       WHERE e.contato_id = b.id AND k.tipo IN ('calendario', 'promocao')
         AND e.status IN ('enviado', 'pendente', 'enviando', 'manual')
    ) mk ON true
  ), calc AS (
    SELECT d.*,
      CASE WHEN d.tipo = 'comprador' OR d.realizado_em IS NOT NULL
           THEN greatest(d.ultimo_servico_em, d.realizado_em) END AS c_cliente_em,
      greatest(d.orcamento_em, d.quote_em, d.lead_orcamento_em, d.lead_orcamento_enviado_em) AS c_orcamento_em,
      greatest(d.perdido_preco_em,
               CASE WHEN d.motivo_perda IN ('preço', 'preco', 'concorrente mais barato') THEN d.perdido_em END)
        AS c_perdido_preco_em,
      coalesce(d.last_interaction_at, d.primeira_mensagem_em, d.lead_criado_em, d.lead_entrada_em) AS c_conversa_em,
      d.motivo_perda = 'não está na região atendida' AS fora_regiao
    FROM dados d
  )
  SELECT c.id, c.nome, c.primeiro_nome, c.normalized_phone,
    c.c_cliente_em, c.ultimo_servico_tipo,
    c.c_orcamento_em, c.quote_total, c.quote_a_vista, c.quote_km,
    c.c_conversa_em, c.c_perdido_preco_em, c.agendado_para,
    -- Orçamento sem agendamento: orçamento mais novo que o último serviço, sem serviço marcado,
    -- sem perda por preço nos últimos 90 dias.
    (c.c_orcamento_em IS NOT NULL
      AND (c.c_cliente_em IS NULL OR c.c_orcamento_em > c.c_cliente_em)
      AND c.agendado_para IS NULL AND NOT coalesce(c.fora_regiao, false)
      AND NOT coalesce(c.c_perdido_preco_em >= (c.hoje - 90)::timestamp AT TIME ZONE 'America/Sao_Paulo', false)),
    -- Conversou e não pediu orçamento (e ainda não é cliente nem tem serviço marcado).
    (c.c_orcamento_em IS NULL AND c.c_cliente_em IS NULL AND c.agendado_para IS NULL
      AND c.c_conversa_em IS NOT NULL AND NOT coalesce(c.fora_regiao, false)
      AND NOT coalesce(c.c_perdido_preco_em >= (c.hoje - 90)::timestamp AT TIME ZONE 'America/Sao_Paulo', false)),
    c.hoje - (c.c_cliente_em AT TIME ZONE 'America/Sao_Paulo')::date,
    c.hoje - (c.c_orcamento_em AT TIME ZONE 'America/Sao_Paulo')::date,
    c.hoje - (c.c_conversa_em AT TIME ZONE 'America/Sao_Paulo')::date,
    coalesce(nullif(btrim(c.cliente_endereco), ''), nullif(btrim(c.quote_endereco), ''), c.geo_endereco),
    coalesce(nullif(btrim(c.cliente_cep), ''), nullif(btrim(c.quote_cep), '')),
    coalesce(c.cliente_lat, c.latitude), coalesce(c.cliente_lon, c.longitude),
    c.optout_em IS NOT NULL, private.contato_interno(_emp, c.normalized_phone),
    c.sem_pos_venda AND c.c_cliente_em IS NOT NULL,
    c.ultimo_marketing_em,
    -- OS recente (90 dias) ou ainda não concluída: fora de conversa, orçamento e promoção.
    private.mkt_contato_tem_os(c.id, c.hoje),
    -- Garantia ou reclamação em aberto (mesma regra da Alice): fora de todo o marketing.
    private.mkt_contato_garantia_aberta(c.id)
  FROM calc c;
$$;
REVOKE ALL ON FUNCTION private.mkt_listas_dados(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mkt_listas_dados(uuid, date) TO service_role;

-- ---------------------------------------------------------------- motivo com garantia e "tem OS"
-- A versão de 8 parâmetros é renomeada (ficaria ambígua com a nova, que tem dois parâmetros com padrão).
ALTER FUNCTION private.mkt_motivo_fora(boolean, int, boolean, boolean, boolean, date, text, timestamptz)
  RENAME TO mkt_motivo_fora_ate_20261112;
CREATE FUNCTION private.mkt_motivo_fora(
  _promocao boolean, _limite int, _optout boolean, _interno boolean, _sem_pos_venda boolean,
  _agendado_para date, _primeiro_nome text, _ultimo_marketing_em timestamptz,
  _garantia_aberta boolean DEFAULT false, _tem_os boolean DEFAULT false)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _optout THEN 'saiu das ofertas'
    WHEN _interno THEN 'contato interno da equipe'
    WHEN _garantia_aberta THEN 'garantia/reclamação em aberto'
    WHEN _sem_pos_venda THEN 'cliente marcado sem pós-venda'
    WHEN _promocao AND _agendado_para IS NOT NULL THEN 'tem serviço marcado'
    WHEN _tem_os THEN 'tem OS'
    WHEN _promocao AND nullif(btrim(coalesce(_primeiro_nome, '')), '') IS NULL THEN 'sem nome'
    WHEN _ultimo_marketing_em > now() - make_interval(days => _limite)
      THEN 'recebeu marketing há ' || greatest(0, extract(day FROM now() - _ultimo_marketing_em)::int) || ' dias'
  END;
$$;

-- ---------------------------------------------------------------- tela Listas, promoção e planilha
CREATE OR REPLACE FUNCTION private.mkt_publico(_emp uuid, _filtros jsonb, _promocao boolean DEFAULT false,
                                               _hoje date DEFAULT NULL)
RETURNS TABLE (
  contato_id uuid, nome text, telefone text, familias text[],
  cliente_em timestamptz, servico_tipo text, orcamento_em timestamptz, orcamento_valor numeric,
  orcamento_a_vista numeric, orcamento_km numeric, conversa_em timestamptz,
  perdido_preco_em timestamptz, agendado_para date,
  dias_cliente int, dias_orcamento int, dias_conversa int,
  endereco text, cep text, latitude double precision, longitude double precision,
  pode_receber boolean, motivo text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT x.contato_id, x.nome, x.telefone, f.fams,
    x.cliente_em, x.servico_tipo, x.orcamento_em, x.orcamento_valor, x.orcamento_a_vista, x.orcamento_km,
    x.conversa_em, x.perdido_preco_em, x.agendado_para, x.dias_cliente, x.dias_orcamento, x.dias_conversa,
    x.endereco, x.cep, x.latitude, x.longitude,
    m.motivo IS NULL, m.motivo
  FROM private.mkt_listas_dados(_emp, _hoje) x
  CROSS JOIN LATERAL (SELECT private.mkt_familias(_filtros, x.em_orcamento, x.dias_orcamento, x.em_conversa,
                        x.dias_conversa, x.dias_cliente, x.perdido_preco_em, x.agendado_para) AS fams) f
  CROSS JOIN LATERAL (SELECT private.mkt_motivo_fora(_promocao, private.mkt_limite_marketing(_emp), x.optout,
                        x.interno, x.sem_pos_venda, x.agendado_para, x.primeiro_nome,
                        x.ultimo_marketing_em, x.garantia_aberta,
                        -- "tem OS" só tira de conversa/orçamento e da promoção (cliente e agendado continuam).
                        x.tem_os AND (_promocao OR NOT (f.fams && ARRAY['clientes', 'agendado']))) AS motivo) m
  WHERE cardinality(f.fams) > 0;
$$;
REVOKE ALL ON FUNCTION private.mkt_publico(uuid, jsonb, boolean, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mkt_publico(uuid, jsonb, boolean, date) TO service_role;

-- ---------------------------------------------------------------- preparação da campanha
CREATE OR REPLACE FUNCTION public.mkt_preparar_campanha(_campanha uuid, _hoje date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hoje date := coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  c public.mkt_campanhas;
  cfg public.mkt_configuracoes;
  limite int;
  segs jsonb;
  datas date[];
  d date;
  total int;
  n_lotes int;
  i int;
  v_estimativa jsonb;
BEGIN
  SELECT * INTO c FROM public.mkt_campanhas WHERE id = _campanha FOR UPDATE;
  IF c.id IS NULL OR c.tipo <> 'calendario' THEN
    RAISE EXCEPTION 'Campanha não encontrada.';
  END IF;
  IF c.status NOT IN ('rascunho', 'aguardando_aprovacao', 'bloqueada') THEN
    RAISE EXCEPTION 'A campanha já foi %. Não dá para preparar de novo.', c.status;
  END IF;
  cfg := private.mkt_config(c.empresa_id);
  limite := private.mkt_limite_marketing(c.empresa_id);
  segs := private.mkt_listas_da_campanha(c.listas, c.grupos);
  -- Os grupos ainda alimentam a tela "Base" e os relatórios antigos.
  PERFORM public.mkt_calcular_grupos(c.empresa_id, hoje);

  DELETE FROM public.mkt_envios WHERE campanha_id = c.id;
  DELETE FROM public.mkt_lotes WHERE campanha_id = c.id;

  CREATE TEMP TABLE IF NOT EXISTS mkt_sel_lotes (
    ordem int, contato_id uuid, normalized_phone text, grupo text, template text, sn boolean,
    familia text, de int, ate int, temperatura int
  ) ON COMMIT DROP;
  DELETE FROM mkt_sel_lotes WHERE true;
  INSERT INTO mkt_sel_lotes (ordem, contato_id, normalized_phone, grupo, template, sn, familia, de, ate,
                             temperatura)
  WITH dados AS MATERIALIZED (
    SELECT x.* FROM private.mkt_listas_dados(c.empresa_id, hoje) x
     WHERE private.mkt_motivo_fora(false, limite, x.optout, x.interno, x.sem_pos_venda, x.agendado_para,
                                   x.primeiro_nome, x.ultimo_marketing_em, x.garantia_aberta) IS NULL
       AND x.agendado_para IS NULL
       -- Na janela do lembrete de 6 meses ou do 13º mês: o lembrete já fala com a pessoa.
       AND NOT private.mkt_na_janela_lembrete(x.contato_id, hoje)
       -- Quem já está numa campanha em andamento fica para depois.
       AND NOT EXISTS (SELECT 1 FROM public.mkt_envios e JOIN public.mkt_campanhas o ON o.id = e.campanha_id
                        WHERE e.contato_id = x.contato_id AND o.id <> c.id
                          AND e.status IN ('pendente', 'manual', 'enviando')
                          AND o.status IN ('aguardando_aprovacao', 'aprovada', 'enviando', 'pausada'))
  ), segmentos AS (
    SELECT s.value ->> 'grupo' AS grupo, s.value ->> 'familia' AS familia, s.ord,
           (s.value ->> 'de')::int AS de, (s.value ->> 'ate')::int AS ate,
           jsonb_build_object(s.value ->> 'familia', s.value - 'grupo' - 'familia') AS filtro,
           -- Quentes primeiro, frias por último (a trava de bloqueio age antes de chegar nelas):
           -- 1 clientes, 2 orçamentos até 1 ano, 3 perdido por preço, 4 orçamentos de mais de
           -- 1 ano, 5 conversou e não pediu orçamento.
           CASE s.value ->> 'familia'
             WHEN 'clientes' THEN 1
             WHEN 'orcamento' THEN CASE WHEN coalesce((s.value ->> 'de')::int, 0) >= 365 THEN 4 ELSE 2 END
             WHEN 'conversa' THEN 5
             ELSE 3 END AS temperatura
      FROM jsonb_array_elements(segs) WITH ORDINALITY s(value, ord)
  ), candidatos AS (
    SELECT dd.contato_id, dd.telefone, dd.primeiro_nome, sg.grupo, sg.ord, sg.familia, sg.de, sg.ate,
           sg.temperatura,
           row_number() OVER (PARTITION BY sg.grupo
                              ORDER BY CASE sg.familia WHEN 'orcamento' THEN dd.dias_orcamento
                                                       WHEN 'conversa' THEN dd.dias_conversa
                                                       WHEN 'clientes' THEN dd.dias_cliente END NULLS LAST,
                                       dd.telefone) AS pos_grupo
      FROM segmentos sg
      -- Quem tem OS recente ou em aberto não entra em conversa nem orçamento (só em clientes).
      JOIN dados dd ON cardinality(private.mkt_familias(sg.filtro, dd.em_orcamento AND NOT dd.tem_os,
                         dd.dias_orcamento, dd.em_conversa AND NOT dd.tem_os, dd.dias_conversa,
                         dd.dias_cliente, dd.perdido_preco_em, dd.agendado_para)) > 0
     -- Quem tocou em "não quero" para este grupo nos últimos 120 dias fica fora dele.
     WHERE NOT EXISTS (SELECT 1 FROM public.mkt_contatos k
                        WHERE k.id = dd.contato_id AND k.recusou_grupo = sg.grupo
                          AND k.recusou_em > now() - interval '120 days')
  ), unicos AS (
    -- Sem repetir pessoa: fica no primeiro segmento da campanha em que aparece.
    SELECT DISTINCT ON (x.contato_id) x.*
      FROM candidatos x
     WHERE x.pos_grupo <= coalesce((c.limites ->> x.grupo)::int, 1000000)
     ORDER BY x.contato_id, x.ord
  )
  SELECT row_number() OVER (ORDER BY u.temperatura, coalesce(u.de, 0), u.ord, u.pos_grupo) - 1,
         u.contato_id, u.telefone, u.grupo,
         coalesce(c.templates ->> u.grupo,
                  CASE u.grupo WHEN 'CV' THEN private.mkt_modelo(c.empresa_id, 'conversa')
                               WHEN 'PP' THEN private.mkt_modelo(c.empresa_id, 'preco')
                               ELSE private.mkt_template_padrao(c.empresa_id, u.grupo, c.mes_ref) END)
           || CASE WHEN u.primeiro_nome IS NULL THEN '_sn' ELSE '' END,
         u.primeiro_nome IS NULL, u.familia, u.de, u.ate, u.temperatura
    FROM unicos u;

  SELECT count(*) INTO total FROM mkt_sel_lotes;
  n_lotes := greatest(1, ceil(total::numeric / cfg.lote_tamanho)::int);

  -- Datas: as do calendário que caem nos dias de disparo, a partir de amanhã; faltando, as seguintes.
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO datas
    FROM (SELECT DISTINCT unnest(c.datas_disparo) AS x) t
   WHERE (c.hora_inicio IS NULL AND extract(isodow FROM x)::smallint = ANY (cfg.dias_disparo) AND x > hoje)
      -- Dia e horário próprios: qualquer dia escolhido, inclusive hoje se ainda faltam 15 minutos.
      OR (c.hora_inicio IS NOT NULL
          AND (x > hoje OR (x = hoje AND ((x + c.hora_inicio)::timestamp AT TIME ZONE 'America/Sao_Paulo')
                                         > now() + interval '15 minutes')));
  d := coalesce((SELECT max(x) FROM unnest(datas) x), hoje);
  WHILE coalesce(array_length(datas, 1), 0) < n_lotes LOOP
    d := private.mkt_proximo_dia_util(d + 1, cfg.dias_disparo);
    datas := datas || d;
  END LOOP;

  FOR i IN 1..n_lotes LOOP
    INSERT INTO public.mkt_lotes (empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, quantidade)
    -- Etiqueta própria da campanha (duas campanhas no mesmo mês não se misturam no Chatwoot).
    VALUES (c.empresa_id, c.id, i, 'camp-' || to_char(c.mes_ref, 'YYYY-MM') || '-' || left(c.id::text, 6) || '-l' || i,
            datas[i],
            (SELECT count(*) FROM mkt_sel_lotes WHERE ordem / cfg.lote_tamanho = i - 1));
  END LOOP;
  INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo,
    template_nome, variante_sn, ordem)
  SELECT c.empresa_id, c.id, l.id, s.contato_id, s.normalized_phone, s.grupo, s.template, s.sn,
         s.ordem % cfg.lote_tamanho
    FROM mkt_sel_lotes s JOIN public.mkt_lotes l ON l.campanha_id = c.id AND l.numero = s.ordem / cfg.lote_tamanho + 1;

  SELECT jsonb_build_object(
      'total', total,
      'por_grupo', coalesce((SELECT jsonb_object_agg(grupo, n) FROM (SELECT grupo, count(*) n FROM mkt_sel_lotes GROUP BY grupo) g), '{}'),
      'por_modelo', coalesce((SELECT jsonb_object_agg(template, n) FROM (SELECT template, count(*) n FROM mkt_sel_lotes GROUP BY template) m), '{}'),
      'sem_nome', (SELECT count(*) FROM mkt_sel_lotes WHERE sn),
      'custo', round(total * c.custo_msg_estimado, 2),
      'lotes', n_lotes,
      'datas', to_jsonb(datas[1:n_lotes]),
      'limite_dias', limite,
      'hora', to_char(coalesce(c.hora_inicio, make_time(cfg.hora_disparo, 0, 0)), 'HH24:MI'),
      -- Ordem dos lotes por lista, para a prévia: quentes primeiro, frias por último.
      'ordem', coalesce((
        SELECT jsonb_agg(jsonb_build_object('grupo', grupo, 'familia', familia, 'de', de, 'ate', ate,
                                            'pessoas', n, 'primeiro_lote', l1, 'ultimo_lote', l2,
                                            'fria', temperatura >= 4)
                         ORDER BY o1)
          FROM (SELECT grupo, familia, de, ate, temperatura, count(*) n, min(ordem) o1,
                       min(ordem) / cfg.lote_tamanho + 1 l1, max(ordem) / cfg.lote_tamanho + 1 l2
                  FROM mkt_sel_lotes GROUP BY grupo, familia, de, ate, temperatura) g), '[]'))
    INTO v_estimativa;

  IF c.crm_campaign_id IS NULL THEN
    INSERT INTO public.crm_campaigns (empresa_id, platform, campaign_name, advertised_service, active)
    VALUES (c.empresa_id, 'WhatsApp', c.nome, c.tema, true) RETURNING id INTO c.crm_campaign_id;
  END IF;
  UPDATE public.mkt_campanhas
     SET status = 'aguardando_aprovacao', motivo_status = NULL, preparada_em = now(),
         estimativa = v_estimativa, crm_campaign_id = c.crm_campaign_id,
         listas = coalesce(listas, segs)
   WHERE id = c.id;
  PERFORM private.mkt_log(c.empresa_id, 'campanha', 'preparada', v_estimativa, c.id);
  RETURN v_estimativa;
END $function$;

-- ---------------------------------------------------------------- presas e contagem (prévia)
CREATE OR REPLACE FUNCTION public.mkt_campanha_presas(_campanha uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH emp AS (SELECT private.mkt_empresa_marketing() AS id),
  k AS (
    SELECT c.* FROM public.mkt_campanhas c, emp WHERE c.id = _campanha AND c.empresa_id = emp.id
  ), segs AS (
    SELECT s.value AS seg, s.ord
      FROM k, jsonb_array_elements(private.mkt_listas_da_campanha(k.listas, k.grupos)) WITH ORDINALITY s(value, ord)
  ), outras AS MATERIALIZED (
    SELECT e.contato_id, o.id, o.nome, o.status
      FROM public.mkt_envios e
      JOIN public.mkt_campanhas o ON o.id = e.campanha_id
      JOIN emp ON o.empresa_id = emp.id
     WHERE o.id <> _campanha AND o.tipo IN ('calendario', 'promocao')
       AND o.status IN ('aguardando_aprovacao', 'aprovada', 'pausada')
       AND e.status IN ('pendente', 'manual')
  ), d AS MATERIALIZED (
    SELECT x.*
      FROM emp, private.mkt_listas_dados(emp.id, NULL) x
      -- Sem a outra campanha, poderia receber: o último marketing de verdade (enviado ou
      -- chamado à mão) não bloqueia e nada mais impede.
      CROSS JOIN LATERAL (
        SELECT greatest(max(e.enviado_em), (SELECT (ct.chamado_manual_em::timestamp AT TIME ZONE 'America/Sao_Paulo')
                                              FROM public.mkt_contatos ct WHERE ct.id = x.contato_id)) AS ultimo
          FROM public.mkt_envios e JOIN public.mkt_campanhas kk ON kk.id = e.campanha_id
         WHERE e.contato_id = x.contato_id AND kk.tipo IN ('calendario', 'promocao')
           AND e.status IN ('enviado', 'enviando')
      ) r
     WHERE EXISTS (SELECT 1 FROM k)
       AND EXISTS (SELECT 1 FROM outras o WHERE o.contato_id = x.contato_id)
       AND x.agendado_para IS NULL
       AND private.mkt_motivo_fora(false, private.mkt_limite_marketing(emp.id), x.optout, x.interno,
             x.sem_pos_venda, x.agendado_para, x.primeiro_nome, r.ultimo, x.garantia_aberta) IS NULL
       AND NOT private.mkt_na_janela_lembrete(x.contato_id, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  ), m AS (
    SELECT DISTINCT ON (d.contato_id) d.contato_id, s.seg ->> 'grupo' AS grupo
      FROM segs s
      JOIN d ON cardinality(private.mkt_familias(
                  jsonb_build_object(s.seg ->> 'familia', s.seg - 'grupo' - 'familia'),
                  d.em_orcamento AND NOT d.tem_os, d.dias_orcamento, d.em_conversa AND NOT d.tem_os,
                  d.dias_conversa, d.dias_cliente, d.perdido_preco_em, d.agendado_para)) > 0
     ORDER BY d.contato_id, s.ord
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM m),
    'por_grupo', coalesce((SELECT jsonb_object_agg(grupo, n) FROM (SELECT grupo, count(*) AS n FROM m GROUP BY grupo) g), '{}'::jsonb),
    'campanhas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'status', status, 'pessoas', n) ORDER BY n DESC)
                             FROM (SELECT o.id, o.nome, o.status, count(DISTINCT m.contato_id) AS n
                                     FROM m JOIN outras o ON o.contato_id = m.contato_id
                                    GROUP BY o.id, o.nome, o.status) c), '[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.mkt_campanha_presas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mkt_campanha_presas(uuid) TO authenticated, service_role;

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
             x.sem_pos_venda, x.agendado_para, x.primeiro_nome, x.ultimo_marketing_em, x.garantia_aberta) IS NULL
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
                       d.em_orcamento AND NOT d.tem_os, d.dias_orcamento, d.em_conversa AND NOT d.tem_os,
                       d.dias_conversa, d.dias_cliente, d.perdido_preco_em, d.agendado_para)) > 0
     GROUP BY s.seg, s.ord
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('grupo', grupo, 'total', total, 'podem', podem) ORDER BY ord),
                  '[]'::jsonb)
    FROM c;
$$;
REVOKE ALL ON FUNCTION public.mkt_campanha_contagem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mkt_campanha_contagem(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- lembretes (só garantia)
CREATE OR REPLACE FUNCTION public.mkt_gerar_gatilhos(_emp uuid, _hoje date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hoje date := coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  mes date := date_trunc('month', coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date))::date;
  cfg public.mkt_configuracoes := private.mkt_config(_emp);
  limite int := private.mkt_limite_marketing(_emp);
  -- Quem entra no lote de cada gatilho (contato_id, fone, ref, sn, adiado), sem tabela temporária.
  cand jsonb;
  g text;
  campanha uuid;
  lote uuid;
  ligado boolean;
  -- Higienização 6 meses e impermeabilização 13º mês (e o lembrete dele) esperam aprovação.
  segurar boolean;
  inicio timestamptz;
  n int;
  adiados int;
  resultado jsonb := '{}';
BEGIN
  inicio := greatest(now(), (hoje + time '09:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');
  FOREACH g IN ARRAY ARRAY['C1', 'C2', 'C3', 'C3L'] LOOP
    ligado := CASE g WHEN 'C1' THEN cfg.gatilho_c1_ligado WHEN 'C2' THEN cfg.gatilho_c2_ligado
                     ELSE cfg.gatilho_c3_ligado END;
    segurar := ligado AND g <> 'C1';
    IF g = 'C1' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]') INTO cand FROM (
      SELECT c.id AS contato_id, c.normalized_phone AS fone, 'C1:' || c.ultima_work_order_id AS ref,
             c.primeiro_nome IS NULL AS sn, false AS adiado
        FROM public.mkt_contatos c
       WHERE c.empresa_id = _emp AND c.optout_em IS NULL AND NOT c.sem_pos_venda
         AND NOT private.mkt_contato_garantia_aberta(c.id)
         AND c.ultima_work_order_id IS NOT NULL
         AND (c.pos_venda_em AT TIME ZONE 'America/Sao_Paulo')::date = hoje - 1
         -- Pós-venda da Alice ligado: ele substitui o C1 (a cliente não recebe dois).
         AND NOT EXISTS (SELECT 1 FROM public.ia_configuracoes ia
                          WHERE ia.empresa_id = _emp AND ia.ativo AND ia.pos_venda_ligado)) q;
    ELSIF g IN ('C2', 'C3') THEN
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]') INTO cand FROM (
      SELECT j.id AS contato_id, j.normalized_phone AS fone, g || ':' || j.id || ':' || j.servico AS ref,
             j.primeiro_nome IS NULL AS sn, j.bloqueado AS adiado
        FROM (
          SELECT c.id, c.normalized_phone, c.primeiro_nome, x.servico, x.ini, x.fim_normal, x.fim_adiado,
                 -- Recebeu campanha ou promoção há menos de N dias: fica para o dia em que completar.
                 m.ultimo IS NOT NULL AND m.ultimo + limite > hoje AS bloqueado,
                 m.ultimo + limite AS liberado_em,
                 -- Ficou para depois dentro da janela normal: pode sair até o fim da janela do lembrete.
                 EXISTS (SELECT 1 FROM public.mkt_envios e JOIN public.mkt_campanhas k ON k.id = e.campanha_id
                          WHERE e.contato_id = c.id AND k.tipo IN ('calendario', 'promocao')
                            AND e.status IN ('enviado', 'enviando', 'pendente', 'manual')
                            AND (coalesce(e.enviado_em, e.agendado_para, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date
                                BETWEEN x.ini - limite + 1 AND x.fim_normal)
                 OR coalesce(c.chamado_manual_em BETWEEN x.ini - limite + 1 AND x.fim_normal, false) AS foi_adiado
            FROM public.mkt_contatos c
            CROSS JOIN LATERAL (
              SELECT s AS servico,
                     CASE g WHEN 'C2' THEN (s + interval '6 months')::date ELSE (s + interval '1 year 15 days')::date END AS ini,
                     CASE g WHEN 'C2' THEN (s + interval '6 months')::date + 6 ELSE (s + interval '1 year 1 month')::date END AS fim_normal,
                     CASE g WHEN 'C2' THEN (s + interval '7 months')::date ELSE (s + interval '1 year 1 month')::date END AS fim_adiado
                FROM (SELECT (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date AS s) d
            ) x
            CROSS JOIN LATERAL (
              -- "Já chamei manualmente" conta como marketing naquele dia.
              SELECT greatest(max((coalesce(e.enviado_em, e.agendado_para, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date),
                              c.chamado_manual_em) AS ultimo
                FROM public.mkt_envios e JOIN public.mkt_campanhas k ON k.id = e.campanha_id
               WHERE e.contato_id = c.id AND k.tipo IN ('calendario', 'promocao')
                 AND e.status IN ('enviado', 'enviando', 'pendente', 'manual')
            ) m
           WHERE c.empresa_id = _emp AND c.tipo = 'comprador' AND c.optout_em IS NULL AND NOT c.sem_pos_venda
             AND NOT private.mkt_contato_garantia_aberta(c.id)
             AND c.ultimo_servico_em IS NOT NULL
             AND c.ultimo_servico_tipo = CASE g WHEN 'C2' THEN 'higienizacao' ELSE 'impermeabilizacao' END
             AND NOT coalesce(c.recusou_grupo = g AND c.recusou_em > now() - interval '120 days', false)
             -- Outro lembrete (não o pós-venda) nos últimos 30 dias: continua fora, como antes.
             AND NOT EXISTS (SELECT 1 FROM public.mkt_envios e JOIN public.mkt_campanhas k ON k.id = e.campanha_id
                              WHERE e.contato_id = c.id AND e.status = 'enviado' AND k.tipo = 'gatilho'
                                AND e.enviado_em > now() - interval '30 days' AND k.gatilho IS DISTINCT FROM 'C1')
             AND NOT EXISTS (SELECT 1 FROM public.crm_leads l JOIN public.config_options s ON s.id = l.status_id
                              WHERE l.empresa_id = c.empresa_id AND l.is_open
                                AND private.telefone_chave(l.normalized_phone) = private.telefone_chave(c.normalized_phone)
                                AND s.metadata->>'stage' IN ('negociacao', 'orcamento', 'aguardando'))
        ) j
       WHERE hoje >= j.ini
         AND (hoje <= j.fim_normal OR (hoje <= j.fim_adiado AND j.foi_adiado))
         -- Quem só completa os 30 dias depois da janela não fica "para depois": perde o lembrete.
         AND (NOT j.bloqueado OR j.liberado_em <= j.fim_adiado)) q;
    ELSE
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]') INTO cand FROM (
      SELECT c.id AS contato_id, c.normalized_phone AS fone, 'C3L:' || e.id AS ref,
             c.primeiro_nome IS NULL AS sn, false AS adiado
        FROM public.mkt_envios e
        JOIN public.mkt_campanhas k ON k.id = e.campanha_id AND k.gatilho = 'C3'
        JOIN public.mkt_contatos c ON c.id = e.contato_id
       WHERE e.empresa_id = _emp AND e.status = 'enviado' AND e.respondido_em IS NULL
         AND e.enviado_em <= now() - interval '24 hours' AND e.enviado_em > now() - interval '7 days'
         AND c.optout_em IS NULL AND NOT private.mkt_contato_garantia_aberta(c.id)) q;
    END IF;

    SELECT count(*) FILTER (WHERE NOT t.adiado), count(*) FILTER (WHERE t.adiado) INTO n, adiados
      FROM jsonb_to_recordset(cand) AS t(contato_id uuid, fone text, ref text, sn boolean, adiado boolean)
     WHERE NOT EXISTS (SELECT 1 FROM public.mkt_envios x WHERE x.empresa_id = _emp AND x.gatilho_ref = t.ref);
    IF n > 0 THEN
      campanha := private.mkt_campanha_gatilho(_emp, g, mes);
      INSERT INTO public.mkt_lotes (empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, status, adiados)
      VALUES (_emp, campanha, extract(day FROM hoje)::int,
              'gat-' || lower(g) || '-' || to_char(hoje, 'YYYY-MM-DD'), hoje,
              CASE WHEN segurar THEN 'aguardando_aprovacao' ELSE 'aprovado' END, adiados)
      ON CONFLICT (campanha_id, numero) DO UPDATE SET status = CASE
        WHEN segurar THEN 'aguardando_aprovacao'
        WHEN public.mkt_lotes.status IN ('concluido') THEN 'enviando' ELSE public.mkt_lotes.status END,
        adiados = EXCLUDED.adiados
      RETURNING id INTO lote;
      INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo,
        template_nome, variante_sn, ordem, gatilho_ref, status, agendado_para)
      SELECT _emp, campanha, lote, t.contato_id, t.fone, CASE g WHEN 'C3L' THEN 'C3' ELSE g END,
             (SELECT template_nome FROM public.mkt_campanhas WHERE id = campanha) || CASE WHEN t.sn THEN '_sn' ELSE '' END,
             t.sn, row_number() OVER (ORDER BY t.contato_id) - 1, t.ref,
             CASE WHEN ligado THEN 'pendente' ELSE 'manual' END,
             CASE WHEN ligado THEN inicio + make_interval(secs => (row_number() OVER (ORDER BY t.contato_id) - 1)::int
                                                              * cfg.intervalo_segundos) END
        FROM jsonb_to_recordset(cand) AS t(contato_id uuid, fone text, ref text, sn boolean, adiado boolean)
       WHERE NOT t.adiado
      ON CONFLICT (empresa_id, gatilho_ref) WHERE gatilho_ref IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT;
      UPDATE public.mkt_lotes SET quantidade = (SELECT count(*) FROM public.mkt_envios WHERE lote_id = lote)
       WHERE id = lote;
      -- Aviso para a equipe (só a equipe: nada vai para o cliente) com a contagem; a prévia fica em Avisos.
      IF segurar AND n > 0 THEN
        PERFORM private.mkt_avisar(_emp, 'lembretes_aprovacao',
          CASE g WHEN 'C2' THEN 'Lembretes de higienização (6 meses) para aprovar'
                 WHEN 'C3' THEN 'Lembretes de impermeabilização (13º mês) para aprovar'
                 ELSE 'Segundo lembrete de impermeabilização para aprovar' END,
          (SELECT count(*) FROM public.mkt_envios WHERE lote_id = lote AND status = 'pendente')
            || ' mensagens prontas.'
            || CASE WHEN adiados > 0 THEN ' ' || adiados
                    || CASE WHEN adiados = 1 THEN ' ficou' ELSE ' ficaram' END
                    || ' para depois (campanha ou promoção há menos de ' || limite || ' dias).' ELSE '' END
            || ' Confira a prévia em Avisos e toque em "Aprovar envio" ou "Não enviar".',
          campanha, lote);
      END IF;
    END IF;
    resultado := resultado || jsonb_build_object(g, jsonb_build_object('novos', n, 'adiados', adiados,
                                                                       'automatico', ligado, 'aprovacao', segurar));
  END LOOP;
  PERFORM private.mkt_log(_emp, 'gatilhos', 'gerados', resultado);
  RETURN resultado;
END $function$;
REVOKE ALL ON FUNCTION public.mkt_gerar_gatilhos(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_gerar_gatilhos(uuid, date) TO service_role;

-- ---------------------------------------------------------------- conferência na hora do envio
CREATE OR REPLACE FUNCTION public.mkt_reservar_envios(_limite integer, _agora timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(envio_id uuid, empresa_id uuid, campanha_id uuid, lote_id uuid, contato_id uuid, normalized_phone text, nome text, primeiro_nome text, template_nome text, variante_sn boolean, idioma text, condicao_texto text, condicao_pct numeric, etiqueta text, grupo text, whatsapp_contact_id uuid, chatwoot_contact_id bigint, conversa_chatwoot_id bigint, conversa_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  agora timestamptz := coalesce(_agora, now());
  hora int := extract(hour FROM coalesce(_agora, now()) AT TIME ZONE 'America/Sao_Paulo')::int;
  dia int := extract(isodow FROM coalesce(_agora, now()) AT TIME ZONE 'America/Sao_Paulo')::int;
BEGIN
  -- Quem saiu (opt-out) depois da preparação não recebe.
  UPDATE public.mkt_envios e SET status = 'cancelado', erro = 'opt-out'
    FROM public.mkt_contatos c
   WHERE c.id = e.contato_id AND e.status IN ('pendente', 'manual') AND c.optout_em IS NOT NULL;
  -- Contato interno da equipe nunca recebe envio de cliente (campanha, gatilho ou promoção).
  UPDATE public.mkt_envios e SET status = 'cancelado', erro = 'contato interno da equipe'
    FROM public.mkt_contatos c
   WHERE c.id = e.contato_id AND e.status IN ('pendente', 'manual')
     AND private.contato_interno(c.empresa_id, c.normalized_phone);
  -- Limite de marketing: recebeu outra campanha ou promoção há menos de N dias.
  UPDATE public.mkt_envios e
     SET status = 'cancelado',
         erro = 'limite de marketing: recebeu outra mensagem há menos de '
                || private.mkt_limite_marketing(e.empresa_id) || ' dias'
    FROM public.mkt_campanhas k
   WHERE k.id = e.campanha_id AND k.tipo IN ('calendario', 'promocao')
     AND e.status = 'pendente' AND e.agendado_para <= agora
     AND EXISTS (
       SELECT 1 FROM public.mkt_envios o JOIN public.mkt_campanhas ok ON ok.id = o.campanha_id
        WHERE o.contato_id = e.contato_id AND o.id <> e.id AND ok.tipo IN ('calendario', 'promocao')
          AND o.status IN ('enviado', 'enviando')
          AND coalesce(o.enviado_em, o.reservado_em)
              > agora - make_interval(days => private.mkt_limite_marketing(e.empresa_id)));
  -- Passou a ter OS (recente ou em aberto) depois da preparação: campanha e promoção não vão.
  UPDATE public.mkt_envios e SET status = 'cancelado', erro = 'tem OS'
    FROM public.mkt_campanhas k
   WHERE k.id = e.campanha_id AND k.tipo IN ('calendario', 'promocao')
     AND e.status IN ('pendente', 'manual')
     AND private.mkt_contato_tem_os(e.contato_id, (agora AT TIME ZONE 'America/Sao_Paulo')::date);
  -- Garantia ou reclamação em aberto: nada de marketing (campanha, promoção ou lembrete).
  UPDATE public.mkt_envios e SET status = 'cancelado', erro = 'garantia/reclamação em aberto'
   WHERE e.status IN ('pendente', 'manual')
     AND private.mkt_contato_garantia_aberta(e.contato_id);
  -- Envio interrompido (servidor caiu no meio): não reenviar às cegas; fica como erro para conferir.
  UPDATE public.mkt_envios SET status = 'erro', erro = 'envio interrompido: confira no Chatwoot'
   WHERE status = 'enviando' AND reservado_em < now() - interval '15 minutes';

  IF hora < 8 OR hora >= 21 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH escolhidos AS (
    SELECT e.id
      FROM public.mkt_envios e
      JOIN public.mkt_lotes l ON l.id = e.lote_id
      JOIN public.mkt_campanhas k ON k.id = e.campanha_id
      JOIN public.mkt_configuracoes cfg ON cfg.empresa_id = e.empresa_id
      -- Empresa ainda em implantação não envia nada a clientes.
      JOIN public.empresas emp ON emp.id = e.empresa_id AND emp.implantacao_liberada_em IS NOT NULL
     WHERE e.status = 'pendente' AND e.agendado_para <= agora
       AND l.status IN ('aprovado', 'enviando')
       -- Campanha com dia e horário próprios: vale o agendado (dia e hora escolhidos), até as 21h.
       AND ((k.tipo = 'calendario' AND k.hora_inicio IS NOT NULL AND k.status IN ('aprovada', 'enviando')
             AND cfg.disparo_ligado)
         OR (k.tipo = 'calendario' AND k.hora_inicio IS NULL AND k.status IN ('aprovada', 'enviando')
             AND cfg.disparo_ligado AND hora < cfg.hora_limite
             AND dia = ANY (cfg.dias_disparo) AND hora >= cfg.hora_disparo)
         OR (k.tipo = 'promocao' AND k.status IN ('aprovada', 'enviando') AND cfg.disparo_ligado
             AND hora < cfg.hora_limite AND hora >= 9)
         OR (k.tipo = 'gatilho' AND hora < cfg.hora_limite AND hora >= 9
             AND ((k.gatilho = 'C1' AND cfg.gatilho_c1_ligado)
               OR (k.gatilho = 'C2' AND cfg.gatilho_c2_ligado)
               OR (k.gatilho IN ('C3', 'C3L') AND cfg.gatilho_c3_ligado))))
     ORDER BY e.agendado_para
     LIMIT greatest(_limite, 0)
     FOR UPDATE OF e SKIP LOCKED
  ), reservados AS (
    UPDATE public.mkt_envios e SET status = 'enviando', reservado_em = now()
      FROM escolhidos x WHERE e.id = x.id
    RETURNING e.*
  ), lotes AS (
    UPDATE public.mkt_lotes l SET status = 'enviando', iniciado_em = coalesce(l.iniciado_em, now())
     WHERE l.id IN (SELECT r.lote_id FROM reservados r) AND l.status = 'aprovado'
    RETURNING l.id
  ), campanhas AS (
    UPDATE public.mkt_campanhas k SET status = 'enviando'
     WHERE k.id IN (SELECT r.campanha_id FROM reservados r) AND k.status = 'aprovada'
    RETURNING k.id
  )
  SELECT r.id, r.empresa_id, r.campanha_id, r.lote_id, r.contato_id, c.normalized_phone, c.nome,
         c.primeiro_nome, r.template_nome, r.variante_sn, cfg.template_idioma, k.condicao_texto,
         k.condicao_pct, l.etiqueta_chatwoot, r.grupo, w.id, w.chatwoot_contact_id,
         cv.chatwoot_conversation_id, cv.status
    FROM reservados r
    JOIN public.mkt_contatos c ON c.id = r.contato_id
    JOIN public.mkt_campanhas k ON k.id = r.campanha_id
    JOIN public.mkt_lotes l ON l.id = r.lote_id
    JOIN public.mkt_configuracoes cfg ON cfg.empresa_id = r.empresa_id
    LEFT JOIN LATERAL (
      SELECT wc.id, wc.chatwoot_contact_id FROM public.whatsapp_contacts wc
       WHERE wc.empresa_id = r.empresa_id
         AND private.telefone_chave(wc.normalized_phone) = private.telefone_chave(c.normalized_phone)
       ORDER BY wc.last_message_at DESC NULLS LAST LIMIT 1
    ) w ON true
    LEFT JOIN LATERAL (
      SELECT v.chatwoot_conversation_id, v.status FROM public.conversas v
       WHERE v.whatsapp_contact_id = w.id AND v.empresa_id = r.empresa_id
       ORDER BY v.ultima_atividade_em DESC NULLS LAST LIMIT 1
    ) cv ON true
   ORDER BY r.agendado_para;
END $function$;

-- ---------------------------------------------------------------- aviso: serviço passado ainda "Agendado"
-- Referência do aviso (ex.: "visita:<id>") para não repetir o mesmo aviso.
ALTER TABLE public.mkt_avisos ADD COLUMN IF NOT EXISTS referencia text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_avisos_referencia
  ON public.mkt_avisos (empresa_id, tipo, referencia) WHERE referencia IS NOT NULL;

-- Visita com data até ontem e ainda Agendado/Reagendado/Em execução, em OS não cancelada, não
-- excluída e não de teste: um aviso só no app por visita ("Serviço de DD/MM da OS X ainda não foi
-- concluído"). Chamada pela varredura (de 5 em 5 min). Devolve quantos avisos criou.
CREATE OR REPLACE FUNCTION public.avisos_servicos_nao_concluidos(_hoje date DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hoje date := coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  n int;
BEGIN
  INSERT INTO public.mkt_avisos (empresa_id, tipo, titulo, mensagem, so_no_app, referencia)
  SELECT w.empresa_id, 'servico_nao_concluido',
         'Serviço ainda não concluído',
         'Serviço de ' || to_char(v.scheduled_date, 'DD/MM') || ' da OS ' || w.os_number
           || ' ainda não foi concluído.',
         true, 'visita:' || v.id
    FROM public.visits v
    JOIN public.work_orders w ON w.id = v.work_order_id
   WHERE v.status IN ('Agendado', 'Reagendado', 'Em execução')
     AND v.scheduled_date <= hoje - 1
     AND w.deleted_at IS NULL AND NOT w.eh_teste AND w.status IS DISTINCT FROM 'Cancelada'
  ON CONFLICT (empresa_id, tipo, referencia) WHERE referencia IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.avisos_servicos_nao_concluidos(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisos_servicos_nao_concluidos(date) TO service_role;
