-- Alice depois do agendamento: confirmação na véspera, pós-venda no dia seguinte ao serviço e
-- pedido de avaliação no Google. Tudo DESLIGADO por empresa (nada é enviado sem "Ativar").
-- Só acrescenta; a única função trocada é mkt_gerar_gatilhos (o C1 do marketing pula quando o
-- pós-venda da Alice estiver ligado, para a cliente não receber dois).

-- 1. Configuração por empresa.
ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS confirmacao_ligada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmacao_hora time NOT NULL DEFAULT '10:00',
  ADD COLUMN IF NOT EXISTS confirmacao_modelo text,
  ADD COLUMN IF NOT EXISTS pos_venda_ligado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pos_venda_hora time NOT NULL DEFAULT '10:00',
  ADD COLUMN IF NOT EXISTS pos_venda_modelo text,
  ADD COLUMN IF NOT EXISTS avaliacao_ligada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avaliacao_link text
    CHECK (avaliacao_link IS NULL OR avaliacao_link ~ '^https://'),
  ADD COLUMN IF NOT EXISTS avaliacao_texto text NOT NULL DEFAULT E'Que bom, {nome}! Fico muito feliz que tenha gostado 💙\n\nPosso te pedir um favorzinho? Se puder deixar uma avaliação pra gente no Google, ajuda demais a {empresa} a crescer e a chegar em mais pessoas que precisam cuidar dos estofados. Leva menos de 1 minutinho: {link}\n\nMuito obrigada por confiar na gente!';

-- Turbine: nomes dos modelos combinados (rascunhos criados em Modelos de mensagem).
UPDATE public.ia_configuracoes
   SET confirmacao_modelo = 'tc_confirmacao_servico', pos_venda_modelo = 'tc_pos_venda'
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND confirmacao_modelo IS NULL;

-- 2. O que a Alice mandou depois do agendamento (um por OS, tipo e dia do serviço) e a resposta.
CREATE TABLE IF NOT EXISTS public.ia_pos_atendimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('confirmacao', 'pos_venda', 'avaliacao')),
  data_servico date NOT NULL,
  -- enviado; ignorado (OS cancelada, Alice tirada da cliente, garantia em aberto...); erro.
  situacao text NOT NULL CHECK (situacao IN ('enviado', 'ignorado', 'erro')),
  motivo text,
  via text CHECK (via IN ('texto', 'modelo')),
  chatwoot_conversation_id bigint,
  conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
  mensagem text,
  enviado_em timestamptz,
  resposta text CHECK (resposta IN ('confirmou', 'remarcar', 'elogio', 'problema', 'outro')),
  respondido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, tipo, data_servico)
);
CREATE INDEX IF NOT EXISTS idx_ia_pos_atendimento_conversa
  ON public.ia_pos_atendimento (chatwoot_conversation_id) WHERE resposta IS NULL;
CREATE INDEX IF NOT EXISTS idx_ia_pos_atendimento_empresa
  ON public.ia_pos_atendimento (empresa_id, created_at DESC);
ALTER TABLE public.ia_pos_atendimento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ia_pos_atendimento FROM anon, authenticated;
GRANT SELECT ON public.ia_pos_atendimento TO authenticated;
GRANT ALL ON public.ia_pos_atendimento TO service_role;
CREATE POLICY ia_pos_atendimento_select ON public.ia_pos_atendimento FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));

-- 3. C1 (pós-venda do marketing) pula quando o pós-venda da Alice está ligado.
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
