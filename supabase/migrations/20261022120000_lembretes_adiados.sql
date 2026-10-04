-- Lembretes de 6 meses (higienização) e 13º mês (impermeabilização) não saem para quem recebeu
-- campanha ou promoção nos últimos 30 dias (o limite de marketing da empresa, 30 por padrão).
-- A pessoa fica para o lote do dia em que completar os 30 dias, se ainda estiver na janela do
-- lembrete (até 7 meses do serviço na higienização; até 13 meses na impermeabilização). A
-- aprovação em Avisos mostra quantas ficaram para depois.
--
-- Só acrescenta mkt_lotes.adiados e troca mkt_gerar_gatilhos (agora sem tabela temporária). O
-- resto é igual ao que está em produção: pós-venda (C1) e o segundo lembrete da impermeabilização
-- (C3L) não mudam, e quem recebeu outro lembrete nos últimos 30 dias continua fora. Quem só é
-- importado depois da janela não recebe lembrete atrasado.

ALTER TABLE public.mkt_lotes ADD COLUMN IF NOT EXISTS adiados integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.mkt_lotes.adiados IS
  'Lembretes deste dia que ficaram para depois: a pessoa recebeu campanha ou promoção há menos de 30 dias.';

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
         AND c.ultima_work_order_id IS NOT NULL
         AND (c.pos_venda_em AT TIME ZONE 'America/Sao_Paulo')::date = hoje - 1) q;
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
                                BETWEEN x.ini - limite + 1 AND x.fim_normal) AS foi_adiado
            FROM public.mkt_contatos c
            CROSS JOIN LATERAL (
              SELECT s AS servico,
                     CASE g WHEN 'C2' THEN (s + interval '6 months')::date ELSE (s + interval '1 year 15 days')::date END AS ini,
                     CASE g WHEN 'C2' THEN (s + interval '6 months')::date + 6 ELSE (s + interval '1 year 1 month')::date END AS fim_normal,
                     CASE g WHEN 'C2' THEN (s + interval '7 months')::date ELSE (s + interval '1 year 1 month')::date END AS fim_adiado
                FROM (SELECT (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date AS s) d
            ) x
            CROSS JOIN LATERAL (
              SELECT max((coalesce(e.enviado_em, e.agendado_para, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date) AS ultimo
                FROM public.mkt_envios e JOIN public.mkt_campanhas k ON k.id = e.campanha_id
               WHERE e.contato_id = c.id AND k.tipo IN ('calendario', 'promocao')
                 AND e.status IN ('enviado', 'enviando', 'pendente', 'manual')
            ) m
           WHERE c.empresa_id = _emp AND c.tipo = 'comprador' AND c.optout_em IS NULL AND NOT c.sem_pos_venda
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
         AND c.optout_em IS NULL) q;
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
