-- Listas do Marketing rápidas (03/11/2026). A contagem dos públicos da Turbine (2.398 contatos)
-- levava 13,6 s e a API do Supabase corta em 8 s: o plano do dia da Tatiana caía e as telas de
-- listas ficavam no limite. Dois pontos comparavam telefone linha a linha, orçamentos (6,2 s) e
-- OS do contato (3,9 s), além das visitas marcadas (0,75 s). Índices pela chave do telefone e as
-- mesmas consultas escritas para usá-los; o resultado das funções não muda.
-- Desfazer: supabase/manual/20261228430000_listas_rapidas_desfazer.sql

-- 1. Índices (funções IMMUTABLE: private.normalizar_telefone e private.telefone_chave).
CREATE INDEX IF NOT EXISTS idx_quotes_telefone_chave
  ON public.quotes (empresa_id, private.telefone_chave(private.normalizar_telefone(cliente_telefone)));
CREATE INDEX IF NOT EXISTS idx_customers_telefone_chave
  ON public.customers (private.telefone_chave(private.normalizar_telefone(phone)));
CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON public.work_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_visits_work_order ON public.visits (work_order_id);

-- 2. OS do contato: o cliente pelo telefone vem do índice, não de uma comparação por OS.
CREATE OR REPLACE FUNCTION private.mkt_contato_tem_os(_contato uuid, _hoje date DEFAULT NULL::date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH c AS (
    SELECT id, empresa_id, customer_id, private.telefone_chave(normalized_phone) AS chave
      FROM public.mkt_contatos WHERE id = _contato
  ), p AS (SELECT coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS hoje)
  SELECT EXISTS (
    SELECT 1
      FROM c, p, public.work_orders w
     WHERE w.empresa_id = c.empresa_id AND w.deleted_at IS NULL AND NOT w.eh_teste
       AND w.status IS DISTINCT FROM 'Cancelada'
       AND ((c.customer_id IS NOT NULL AND w.customer_id = c.customer_id)
            OR (c.chave IS NOT NULL AND w.customer_id IN (SELECT cu.id FROM public.customers cu
                  WHERE private.telefone_chave(private.normalizar_telefone(cu.phone)) = c.chave)))
       AND (w.sale_date >= p.hoje - 90
            OR EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.work_order_id = w.id AND v.status IN ('Agendado', 'Reagendado', 'Em execução'))));
$function$;

-- 3. Dados das listas: a visita marcada do contato idem (orçamentos já usam o índice novo).
CREATE OR REPLACE FUNCTION private.mkt_listas_dados(_emp uuid, _hoje date DEFAULT NULL::date)
 RETURNS TABLE(contato_id uuid, nome text, primeiro_nome text, telefone text, cliente_em timestamp with time zone, servico_tipo text, orcamento_em timestamp with time zone, orcamento_valor numeric, orcamento_a_vista numeric, orcamento_km numeric, conversa_em timestamp with time zone, perdido_preco_em timestamp with time zone, agendado_para date, em_orcamento boolean, em_conversa boolean, dias_cliente integer, dias_orcamento integer, dias_conversa integer, endereco text, cep text, latitude double precision, longitude double precision, optout boolean, interno boolean, sem_pos_venda boolean, ultimo_marketing_em timestamp with time zone, tem_os boolean, garantia_aberta boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       WHERE v.empresa_id = _emp AND v.scheduled_date >= p.hoje
         AND v.status IN ('Agendado', 'Em execução', 'Reagendado')
         AND (w.customer_id = b.customer_id
              OR w.customer_id IN (SELECT vc.id FROM public.customers vc
                                    WHERE private.telefone_chave(private.normalizar_telefone(vc.phone)) = b.chave))
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
$function$;
