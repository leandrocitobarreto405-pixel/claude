-- Preparar campanha sem quem está na janela dos lembretes (parte 2, para o SQL Editor do Supabase:
-- a função apaga e refaz os envios da campanha em preparo, como já fazia, e por isso o Supabase pede
-- confirmação). Igual à versão de 20261018120001, mais a linha de mkt_na_janela_lembrete.

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
       -- Na janela do lembrete de 6 meses ou do 13º mês: o lembrete já fala com a pessoa.
       AND NOT private.mkt_na_janela_lembrete(x.contato_id, hoje)
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
