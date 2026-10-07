-- Marketing: pessoas presas em outra campanha, tirar pessoas antes de aprovar e "já chamei
-- manualmente" (todas as empresas). Nada é apagado; a preparação da campanha não muda.
--
-- 1. mkt_campanhas.repete_de: campanha de origem do "Mandar para quem ficou de fora" (quem foi
--    tirado da origem também fica fora da repetição). Sem chave estrangeira (conferido pelo app).
-- 2. mkt_campanha_retirados: quem o admin tirou de uma campanha antes de aprovar. Leitura para a
--    empresa ativa (admin/atendente); gravação só pelo servidor do app (admin conferido lá).
-- 3. mkt_contatos.chamado_manual_em/_por: a equipe já chamou a pessoa pelo WhatsApp do celular
--    (antes do Chatwoot). Conta como mensagem de marketing naquele dia na regra dos 30 dias:
--    campanhas, promoção, contagem e prévia (mkt_listas_dados) e lembretes (mkt_gerar_gatilhos).
-- 4. mkt_campanha_presas: quantas pessoas das listas da campanha estão fora só porque estão em
--    outra campanha ainda não enviada, e em quais.
-- 5. mkt_marcar_chamado_manual: marca vários telefones de uma vez (planilha), com simulação.

ALTER TABLE public.mkt_campanhas ADD COLUMN IF NOT EXISTS repete_de uuid;
ALTER TABLE public.mkt_contatos
  ADD COLUMN IF NOT EXISTS chamado_manual_em date,
  ADD COLUMN IF NOT EXISTS chamado_manual_por uuid;

CREATE TABLE IF NOT EXISTS public.mkt_campanha_retirados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  campanha_id uuid NOT NULL,
  contato_id uuid NOT NULL,
  retirado_por uuid,
  retirado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, contato_id)
);
CREATE INDEX IF NOT EXISTS idx_mkt_campanha_retirados_empresa ON public.mkt_campanha_retirados (empresa_id);
ALTER TABLE public.mkt_campanha_retirados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mkt_campanha_retirados FROM anon, authenticated;
GRANT SELECT ON public.mkt_campanha_retirados TO authenticated;
GRANT ALL ON public.mkt_campanha_retirados TO service_role;
CREATE POLICY mkt_campanha_retirados_select ON public.mkt_campanha_retirados FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa())
         AND ((SELECT private.tem_papel('admin')) OR (SELECT private.tem_papel('atendente'))));

-- ---------------------------------------------------------------- regra dos 30 dias: listas
CREATE OR REPLACE FUNCTION private.mkt_listas_dados(_emp uuid, _hoje date DEFAULT NULL)
RETURNS TABLE (
  contato_id uuid, nome text, primeiro_nome text, telefone text,
  cliente_em timestamptz, servico_tipo text,
  orcamento_em timestamptz, orcamento_valor numeric, orcamento_a_vista numeric, orcamento_km numeric,
  conversa_em timestamptz, perdido_preco_em timestamptz, agendado_para date,
  em_orcamento boolean, em_conversa boolean,
  dias_cliente int, dias_orcamento int, dias_conversa int,
  endereco text, cep text, latitude double precision, longitude double precision,
  optout boolean, interno boolean, sem_pos_venda boolean, ultimo_marketing_em timestamptz
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
    c.ultimo_marketing_em
  FROM calc c;
$$;
REVOKE ALL ON FUNCTION private.mkt_listas_dados(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mkt_listas_dados(uuid, date) TO service_role;

-- ---------------------------------------------------------------- regra dos 30 dias: lembretes
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

-- Pessoas das listas da campanha que estão fora só porque estão em outra campanha ainda não
-- enviada (esperando aprovação, aprovada ou pausada). {"total", "por_grupo", "campanhas"}.
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
             x.sem_pos_venda, x.agendado_para, x.primeiro_nome, r.ultimo) IS NULL
       AND NOT private.mkt_na_janela_lembrete(x.contato_id, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  ), m AS (
    SELECT DISTINCT ON (d.contato_id) d.contato_id, s.seg ->> 'grupo' AS grupo
      FROM segs s
      JOIN d ON cardinality(private.mkt_familias(
                  jsonb_build_object(s.seg ->> 'familia', s.seg - 'grupo' - 'familia'),
                  d.em_orcamento, d.dias_orcamento, d.em_conversa, d.dias_conversa, d.dias_cliente,
                  d.perdido_preco_em, d.agendado_para)) > 0
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

-- "Já chamei manualmente" para vários telefones (planilha) ou contatos. _itens: [{"telefone" ou
-- "contato_id", "data": "AAAA-MM-DD"}]. Só admin da empresa ativa. _simular: só conta.
-- Guarda a data mais recente (marcar uma data antiga não apaga uma mais nova) e registra no
-- histórico do marketing. Devolve {"marcados", "nao_encontrados": [telefones]}.
CREATE OR REPLACE FUNCTION public.mkt_marcar_chamado_manual(_itens jsonb, _simular boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp uuid := private.mkt_empresa_marketing();
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  marcados int := 0;
  faltando text[] := '{}';
  it record;
  alvo uuid;
BEGIN
  IF NOT private.tem_papel('admin') THEN
    RAISE EXCEPTION 'Só o administrador marca contatos.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) > 5000 THEN
    RAISE EXCEPTION 'Lista inválida (até 5000 contatos por vez).';
  END IF;
  FOR it IN
    SELECT nullif(btrim(v ->> 'telefone'), '') AS fone,
           CASE WHEN (v ->> 'contato_id') ~* '^[0-9a-f-]{36}$' THEN (v ->> 'contato_id')::uuid END AS contato,
           least(coalesce((v ->> 'data')::date, hoje), hoje) AS dia
      FROM jsonb_array_elements(_itens) v
  LOOP
    alvo := NULL;
    IF it.contato IS NOT NULL THEN
      SELECT id INTO alvo FROM public.mkt_contatos WHERE id = it.contato AND empresa_id = emp;
    ELSIF it.fone IS NOT NULL THEN
      SELECT id INTO alvo FROM public.mkt_contatos
       WHERE empresa_id = emp
         AND private.telefone_chave(normalized_phone) = private.telefone_chave(private.normalizar_telefone(it.fone))
       ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    END IF;
    IF alvo IS NULL THEN
      faltando := faltando || coalesce(it.fone, it.contato::text, '?');
      CONTINUE;
    END IF;
    marcados := marcados + 1;
    IF NOT _simular THEN
      UPDATE public.mkt_contatos
         SET chamado_manual_em = greatest(coalesce(chamado_manual_em, it.dia), it.dia),
             chamado_manual_por = auth.uid()
       WHERE id = alvo;
      INSERT INTO public.mkt_eventos (empresa_id, tipo, resultado, contato_id, detalhe)
      VALUES (emp, 'chamado_manual', 'marcado', alvo, jsonb_build_object('data', it.dia, 'por', auth.uid()));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('marcados', marcados, 'nao_encontrados', to_jsonb(faltando));
END $$;
REVOKE ALL ON FUNCTION public.mkt_marcar_chamado_manual(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mkt_marcar_chamado_manual(jsonb, boolean) TO authenticated, service_role;
