-- Configuração por empresa (parte 3): preparação de campanhas com os modelos e dias da empresa.
-- Separada porque o Supabase pede confirmação para aplicar (a função apaga os envios da
-- campanha antes de prepará-la de novo, como já fazia). Sem ela, a preparação continua com os
-- nomes tc_ e terça a quinta, que é a configuração da Turbine.

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
  PERFORM public.mkt_calcular_grupos(c.empresa_id, hoje);

  DELETE FROM public.mkt_envios WHERE campanha_id = c.id;
  DELETE FROM public.mkt_lotes WHERE campanha_id = c.id;

  CREATE TEMP TABLE IF NOT EXISTS mkt_sel (
    ordem int, contato_id uuid, normalized_phone text, grupo text, template text, sn boolean
  ) ON COMMIT DROP;
  DELETE FROM mkt_sel WHERE true;
  INSERT INTO mkt_sel (ordem, contato_id, normalized_phone, grupo, template, sn)
  SELECT row_number() OVER (ORDER BY x.prioridade, x.pos_grupo) - 1,
         x.id, x.normalized_phone, x.grupo_atual,
         coalesce(c.templates->>x.grupo_atual, private.mkt_template_padrao(c.empresa_id, x.grupo_atual, c.mes_ref))
           || CASE WHEN x.primeiro_nome IS NULL THEN '_sn' ELSE '' END,
         x.primeiro_nome IS NULL
    FROM (
      SELECT k.*, array_position(ARRAY['C1', 'C3', 'C2', 'C4', 'C5', 'N1', 'N2', 'N3'], k.grupo_atual) AS prioridade,
             row_number() OVER (PARTITION BY k.grupo_atual
                                ORDER BY k.ultimo_servico_em DESC NULLS LAST, k.lead_entrada_em DESC NULLS LAST,
                                         k.normalized_phone) AS pos_grupo
        FROM public.mkt_contatos k
       WHERE k.empresa_id = c.empresa_id
         AND k.grupo_atual = ANY (c.grupos)
         AND k.optout_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.mkt_envios e JOIN public.mkt_campanhas o ON o.id = e.campanha_id
                          WHERE e.contato_id = k.id AND o.id <> c.id
                            AND e.status IN ('pendente', 'manual', 'enviando')
                            AND o.status IN ('aguardando_aprovacao', 'aprovada', 'enviando', 'pausada'))
    ) x
   WHERE x.pos_grupo <= coalesce((c.limites->>x.grupo_atual)::int, 1000000);

  SELECT count(*) INTO total FROM mkt_sel;
  n_lotes := greatest(1, ceil(total::numeric / cfg.lote_tamanho)::int);

  -- Datas: as do calendário que caem de terça a quinta, a partir de amanhã; faltando, as seguintes.
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
      'datas', to_jsonb(datas[1:n_lotes]))
    INTO v_estimativa;

  IF c.crm_campaign_id IS NULL THEN
    INSERT INTO public.crm_campaigns (empresa_id, platform, campaign_name, advertised_service, active)
    VALUES (c.empresa_id, 'WhatsApp', c.nome, c.tema, true) RETURNING id INTO c.crm_campaign_id;
  END IF;
  UPDATE public.mkt_campanhas
     SET status = 'aguardando_aprovacao', motivo_status = NULL, preparada_em = now(),
         estimativa = v_estimativa, crm_campaign_id = c.crm_campaign_id
   WHERE id = c.id;
  PERFORM private.mkt_log(c.empresa_id, 'campanha', 'preparada', v_estimativa, c.id);
  RETURN v_estimativa;
END $function$;
