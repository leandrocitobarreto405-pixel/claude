-- Preparar campanha: etiqueta própria, lotes com as listas quentes primeiro e dia/horário próprios.
-- PARA RODAR NO SQL EDITOR DO SUPABASE (a função apaga e refaz os envios da campanha em preparo,
-- como já fazia, e por isso o Supabase pede uma confirmação que não chega pelo app).
-- Substitui o arquivo 20261025120001 (que não precisa mais ser rodado; se já foi, este o atualiza).
--
-- Igual à versão de 20261019120001, mais:
-- 1. Etiqueta do lote no Chatwoot com o começo do código da campanha (camp-2026-10-b840e6-l1).
-- 2. Ordem dos lotes: clientes, orçamentos até 1 ano e perdido por preço primeiro; orçamentos de
--    mais de 1 ano e "conversou e não pediu orçamento" por último (a trava pausa antes delas).
-- 3. A estimativa traz "ordem" (cada lista com pessoas, lotes e se é fria) e "hora" do disparo.
-- 4. Campanha com horário próprio (mkt_campanhas.hora_inicio): as datas escolhidas valem em
--    qualquer dia, inclusive hoje (se faltar pelo menos 15 minutos para o horário). Sem horário
--    próprio, continua como antes: só os dias da configuração, a partir de amanhã.

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
                                   x.primeiro_nome, x.ultimo_marketing_em) IS NULL
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
