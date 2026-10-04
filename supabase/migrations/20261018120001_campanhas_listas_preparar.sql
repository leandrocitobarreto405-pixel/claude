-- Campanhas pelas listas (parte 2). Para rodar no SQL Editor do Supabase: as duas funções apagam
-- dados temporários da própria preparação (como já faziam) e por isso o Supabase pede confirmação.
--
-- 1. Preparar campanha: quem recebe sai das listas da campanha (mkt_campanhas.listas; sem listas,
--    as dos grupos antigos), sem repetir pessoa, sem opt-out, contato interno, cliente sem
--    pós-venda, quem tem serviço marcado e quem recebeu campanha ou promoção nos últimos N dias
--    (limite_marketing_dias). O modelo continua o de cada grupo (templates da campanha ou o padrão).
-- 2. Lembretes: o lote do dia de higienização 6 meses e impermeabilização 13º mês (e o lembrete
--    dele) fica esperando aprovação em Avisos; o pós-venda continua saindo sozinho.

-- Lote de lembretes esperando a aprovação do admin (higienização 6 meses e impermeabilização 13º mês).
ALTER TABLE public.mkt_lotes DROP CONSTRAINT IF EXISTS mkt_lotes_status_check;
ALTER TABLE public.mkt_lotes ADD CONSTRAINT mkt_lotes_status_check CHECK (status IN (
  'preparado', 'aprovado', 'enviando', 'pausado', 'concluido', 'cancelado', 'aguardando_aprovacao'));

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
    RAISE EXCEPTION 'A campanha já foi %; não dá para preparar de novo.', c.status;
  END IF;
  cfg := private.mkt_config(c.empresa_id);
  limite := private.mkt_limite_marketing(c.empresa_id);
  segs := private.mkt_listas_da_campanha(c.listas, c.grupos);
  -- Os grupos ainda alimentam a tela "Base" e os relatórios antigos.
  PERFORM public.mkt_calcular_grupos(c.empresa_id, hoje);

  DELETE FROM public.mkt_envios WHERE campanha_id = c.id;
  DELETE FROM public.mkt_lotes WHERE campanha_id = c.id;

  CREATE TEMP TABLE IF NOT EXISTS mkt_sel (
    ordem int, contato_id uuid, normalized_phone text, grupo text, template text, sn boolean
  ) ON COMMIT DROP;
  DELETE FROM mkt_sel WHERE true;
  INSERT INTO mkt_sel (ordem, contato_id, normalized_phone, grupo, template, sn)
  WITH dados AS MATERIALIZED (
    SELECT x.* FROM private.mkt_listas_dados(c.empresa_id, hoje) x
     WHERE private.mkt_motivo_fora(false, limite, x.optout, x.interno, x.sem_pos_venda, x.agendado_para,
                                   x.primeiro_nome, x.ultimo_marketing_em) IS NULL
       AND x.agendado_para IS NULL
       -- Quem já está numa campanha em andamento fica para depois.
       AND NOT EXISTS (SELECT 1 FROM public.mkt_envios e JOIN public.mkt_campanhas o ON o.id = e.campanha_id
                        WHERE e.contato_id = x.contato_id AND o.id <> c.id
                          AND e.status IN ('pendente', 'manual', 'enviando')
                          AND o.status IN ('aguardando_aprovacao', 'aprovada', 'enviando', 'pausada'))
  ), segmentos AS (
    SELECT s.value ->> 'grupo' AS grupo, s.value ->> 'familia' AS familia, s.ord,
           jsonb_build_object(s.value ->> 'familia', s.value - 'grupo' - 'familia') AS filtro
      FROM jsonb_array_elements(segs) WITH ORDINALITY s(value, ord)
  ), candidatos AS (
    SELECT dd.contato_id, dd.telefone, dd.primeiro_nome, sg.grupo, sg.ord,
           row_number() OVER (PARTITION BY sg.grupo
                              ORDER BY CASE sg.familia WHEN 'orcamento' THEN dd.dias_orcamento
                                                       WHEN 'conversa' THEN dd.dias_conversa
                                                       WHEN 'clientes' THEN dd.dias_cliente END NULLS LAST,
                                       dd.telefone) AS pos_grupo
      FROM segmentos sg
      JOIN dados dd ON cardinality(private.mkt_familias(sg.filtro, dd.em_orcamento, dd.dias_orcamento,
                         dd.em_conversa, dd.dias_conversa, dd.dias_cliente, dd.perdido_preco_em,
                         dd.agendado_para)) > 0
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
  SELECT row_number() OVER (ORDER BY u.ord, u.pos_grupo) - 1,
         u.contato_id, u.telefone, u.grupo,
         coalesce(c.templates ->> u.grupo,
                  CASE u.grupo WHEN 'CV' THEN private.mkt_modelo(c.empresa_id, 'conversa')
                               WHEN 'PP' THEN private.mkt_modelo(c.empresa_id, 'preco')
                               ELSE private.mkt_template_padrao(c.empresa_id, u.grupo, c.mes_ref) END)
           || CASE WHEN u.primeiro_nome IS NULL THEN '_sn' ELSE '' END,
         u.primeiro_nome IS NULL
    FROM unicos u;

  SELECT count(*) INTO total FROM mkt_sel;
  n_lotes := greatest(1, ceil(total::numeric / cfg.lote_tamanho)::int);

  -- Datas: as do calendário que caem nos dias de disparo, a partir de amanhã; faltando, as seguintes.
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO datas
    FROM (SELECT DISTINCT unnest(c.datas_disparo) AS x) t
   WHERE extract(isodow FROM x)::smallint = ANY (cfg.dias_disparo) AND x > hoje;
  d := coalesce((SELECT max(x) FROM unnest(datas) x), hoje);
  WHILE coalesce(array_length(datas, 1), 0) < n_lotes LOOP
    d := private.mkt_proximo_dia_util(d + 1, cfg.dias_disparo);
    datas := datas || d;
  END LOOP;

  FOR i IN 1..n_lotes LOOP
    INSERT INTO public.mkt_lotes (empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, quantidade)
    VALUES (c.empresa_id, c.id, i, 'camp-' || to_char(c.mes_ref, 'YYYY-MM') || '-l' || i, datas[i],
            (SELECT count(*) FROM mkt_sel WHERE ordem / cfg.lote_tamanho = i - 1));
  END LOOP;
  INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo,
    template_nome, variante_sn, ordem)
  SELECT c.empresa_id, c.id, l.id, s.contato_id, s.normalized_phone, s.grupo, s.template, s.sn,
         s.ordem % cfg.lote_tamanho
    FROM mkt_sel s JOIN public.mkt_lotes l ON l.campanha_id = c.id AND l.numero = s.ordem / cfg.lote_tamanho + 1;

  SELECT jsonb_build_object(
      'total', total,
      'por_grupo', coalesce((SELECT jsonb_object_agg(grupo, n) FROM (SELECT grupo, count(*) n FROM mkt_sel GROUP BY grupo) g), '{}'),
      'por_modelo', coalesce((SELECT jsonb_object_agg(template, n) FROM (SELECT template, count(*) n FROM mkt_sel GROUP BY template) m), '{}'),
      'sem_nome', (SELECT count(*) FROM mkt_sel WHERE sn),
      'custo', round(total * c.custo_msg_estimado, 2),
      'lotes', n_lotes,
      'datas', to_jsonb(datas[1:n_lotes]),
      'limite_dias', limite)
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
  g text;
  campanha uuid;
  lote uuid;
  ligado boolean;
  -- Higienização 6 meses e impermeabilização 13º mês (e o lembrete dele) esperam aprovação.
  segurar boolean;
  inicio timestamptz;
  n int;
  resultado jsonb := '{}';
BEGIN
  inicio := greatest(now(), (hoje + time '09:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');
  FOREACH g IN ARRAY ARRAY['C1', 'C2', 'C3', 'C3L'] LOOP
    ligado := CASE g WHEN 'C1' THEN cfg.gatilho_c1_ligado WHEN 'C2' THEN cfg.gatilho_c2_ligado
                     ELSE cfg.gatilho_c3_ligado END;
    segurar := ligado AND g <> 'C1';
    CREATE TEMP TABLE IF NOT EXISTS mkt_gat (contato_id uuid, fone text, ref text, sn boolean) ON COMMIT DROP;
    DELETE FROM mkt_gat WHERE true;
    IF g = 'C1' THEN
      INSERT INTO mkt_gat
      SELECT c.id, c.normalized_phone, 'C1:' || c.ultima_work_order_id, c.primeiro_nome IS NULL
        FROM public.mkt_contatos c
       WHERE c.empresa_id = _emp AND c.optout_em IS NULL AND NOT c.sem_pos_venda
         AND c.ultima_work_order_id IS NOT NULL
         AND (c.pos_venda_em AT TIME ZONE 'America/Sao_Paulo')::date = hoje - 1;
    ELSIF g IN ('C2', 'C3') THEN
      INSERT INTO mkt_gat
      SELECT c.id, c.normalized_phone,
             g || ':' || c.id || ':' || (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date,
             c.primeiro_nome IS NULL
        FROM public.mkt_contatos c
       WHERE c.empresa_id = _emp AND c.tipo = 'comprador' AND c.optout_em IS NULL AND NOT c.sem_pos_venda
         AND c.ultimo_servico_em IS NOT NULL
         AND ((g = 'C2' AND c.ultimo_servico_tipo = 'higienizacao'
               AND (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '6 months'
                   BETWEEN hoje - 6 AND hoje)
           OR (g = 'C3' AND c.ultimo_servico_tipo = 'impermeabilizacao'
               AND (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 year 15 days' <= hoje
               AND (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 year 1 month' >= hoje))
         AND NOT coalesce(c.recusou_grupo = g AND c.recusou_em > now() - interval '120 days', false)
         AND NOT EXISTS (SELECT 1 FROM public.mkt_envios e JOIN public.mkt_campanhas k ON k.id = e.campanha_id
                          WHERE e.contato_id = c.id AND e.status = 'enviado'
                            AND e.enviado_em > now() - interval '30 days' AND k.gatilho IS DISTINCT FROM 'C1')
         AND NOT EXISTS (SELECT 1 FROM public.crm_leads l JOIN public.config_options s ON s.id = l.status_id
                          WHERE l.empresa_id = c.empresa_id AND l.is_open
                            AND private.telefone_chave(l.normalized_phone) = private.telefone_chave(c.normalized_phone)
                            AND s.metadata->>'stage' IN ('negociacao', 'orcamento', 'aguardando'));
    ELSE
      INSERT INTO mkt_gat
      SELECT c.id, c.normalized_phone, 'C3L:' || e.id, c.primeiro_nome IS NULL
        FROM public.mkt_envios e
        JOIN public.mkt_campanhas k ON k.id = e.campanha_id AND k.gatilho = 'C3'
        JOIN public.mkt_contatos c ON c.id = e.contato_id
       WHERE e.empresa_id = _emp AND e.status = 'enviado' AND e.respondido_em IS NULL
         AND e.enviado_em <= now() - interval '24 hours' AND e.enviado_em > now() - interval '7 days'
         AND c.optout_em IS NULL;
    END IF;

    SELECT count(*) INTO n FROM mkt_gat
     WHERE NOT EXISTS (SELECT 1 FROM public.mkt_envios x WHERE x.empresa_id = _emp AND x.gatilho_ref = mkt_gat.ref);
    IF n > 0 THEN
      campanha := private.mkt_campanha_gatilho(_emp, g, mes);
      INSERT INTO public.mkt_lotes (empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, status)
      VALUES (_emp, campanha, extract(day FROM hoje)::int,
              'gat-' || lower(g) || '-' || to_char(hoje, 'YYYY-MM-DD'), hoje,
              CASE WHEN segurar THEN 'aguardando_aprovacao' ELSE 'aprovado' END)
      ON CONFLICT (campanha_id, numero) DO UPDATE SET status = CASE
        WHEN segurar THEN 'aguardando_aprovacao'
        WHEN public.mkt_lotes.status IN ('concluido') THEN 'enviando' ELSE public.mkt_lotes.status END
      RETURNING id INTO lote;
      INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo,
        template_nome, variante_sn, ordem, gatilho_ref, status, agendado_para)
      SELECT _emp, campanha, lote, t.contato_id, t.fone, CASE g WHEN 'C3L' THEN 'C3' ELSE g END,
             (SELECT template_nome FROM public.mkt_campanhas WHERE id = campanha) || CASE WHEN t.sn THEN '_sn' ELSE '' END,
             t.sn, row_number() OVER (ORDER BY t.contato_id) - 1, t.ref,
             CASE WHEN ligado THEN 'pendente' ELSE 'manual' END,
             CASE WHEN ligado THEN inicio + make_interval(secs => (row_number() OVER (ORDER BY t.contato_id) - 1)::int
                                                              * cfg.intervalo_segundos) END
        FROM mkt_gat t
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
            || ' mensagens prontas. Confira a prévia em Avisos e toque em "Aprovar envio" ou "Não enviar".',
          campanha, lote);
      END IF;
    END IF;
    resultado := resultado || jsonb_build_object(g, jsonb_build_object('novos', n, 'automatico', ligado,
                                                                       'aprovacao', segurar));
  END LOOP;
  PERFORM private.mkt_log(_emp, 'gatilhos', 'gerados', resultado);
  RETURN resultado;
END $function$;
