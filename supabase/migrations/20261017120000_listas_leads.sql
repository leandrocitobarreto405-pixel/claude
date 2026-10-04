-- Listas de leads (aprovado em 04/10/2026): substituem os grupos C1–N3 na escolha de quem recebe.
-- Filtros acumulados "até X dias" por família, calculados na hora pelas datas do CRM:
--   orcamento  orçamento sem agendamento (pela data do orçamento mais recente)
--   conversa   conversou e não pediu orçamento (pela data da última conversa)
--   clientes   já fez serviço (pela data do último serviço) — cliente nunca sai daqui
--   perdido_preco  perdido por preço ou concorrente mais barato há até 90 dias
--   agendado   tem serviço marcado (hoje ou depois)
-- Nada aqui envia mensagem. Os grupos antigos (grupo_atual) continuam guardados.

-- ================================================================ 1. colunas
ALTER TABLE public.mkt_contatos
  ADD COLUMN IF NOT EXISTS orcamento_em timestamptz,
  ADD COLUMN IF NOT EXISTS perdido_preco_em timestamptz,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS geo_endereco text,
  ADD COLUMN IF NOT EXISTS geo_em timestamptz;

ALTER TABLE public.mkt_configuracoes
  ADD COLUMN IF NOT EXISTS limite_marketing_dias smallint NOT NULL DEFAULT 30
    CHECK (limite_marketing_dias BETWEEN 7 AND 365);

ALTER TABLE public.agenda_configuracoes
  ADD COLUMN IF NOT EXISTS promo_ligada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promo_listas jsonb NOT NULL
    DEFAULT '{"orcamento": {"ate": 10}, "conversa": {"ate": 30}}'::jsonb
    CHECK (jsonb_typeof(promo_listas) = 'object'),
  ADD COLUMN IF NOT EXISTS promo_margem_min numeric(10,2) CHECK (promo_margem_min IS NULL OR promo_margem_min >= 0),
  ADD COLUMN IF NOT EXISTS promo_km_max numeric(6,1) CHECK (promo_km_max IS NULL OR promo_km_max > 0),
  ADD COLUMN IF NOT EXISTS custo_produto_higienizacao numeric(10,2) NOT NULL DEFAULT 0
    CHECK (custo_produto_higienizacao >= 0),
  ADD COLUMN IF NOT EXISTS custo_produto_impermeabilizacao numeric(10,2) NOT NULL DEFAULT 0
    CHECK (custo_produto_impermeabilizacao >= 0);

-- Turbine Clean: já usa a promoção; produto médio informado pelo dono.
UPDATE public.agenda_configuracoes
   SET promo_ligada = true, custo_produto_higienizacao = 6, custo_produto_impermeabilizacao = 80
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';

-- ================================================================ 2. orçamento entra na base
-- Antes só leads e serviços entravam em mkt_contatos; orçamento feito à mão (sem conversa)
-- ficava de fora das listas.
CREATE OR REPLACE FUNCTION private.mkt_orcamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  fone text;
  envio uuid;
BEGIN
  fone := coalesce(
    (SELECT normalized_phone FROM public.crm_leads WHERE id = NEW.crm_lead_id),
    private.normalizar_telefone(NEW.cliente_telefone));
  IF fone IS NULL THEN RETURN NEW; END IF;
  PERFORM private.mkt_upsert_contato(NEW.empresa_id, fone, left(NEW.cliente_nome, 120), 'nao_comprador',
    NULL, NULL, NULL, NULL, 'orcamento', NEW.customer_id, NEW.crm_lead_id);
  SELECT e.id INTO envio FROM public.mkt_envios e
   WHERE e.empresa_id = NEW.empresa_id AND e.status = 'enviado' AND e.quote_id IS NULL
     AND private.telefone_chave(e.normalized_phone) = private.telefone_chave(fone)
     AND e.enviado_em > now() - interval '30 days'
   ORDER BY e.enviado_em DESC LIMIT 1;
  IF envio IS NOT NULL THEN
    UPDATE public.mkt_envios SET quote_id = NEW.id WHERE id = envio;
  END IF;
  RETURN NEW;
END $function$;

-- Orçamentos que já existem.
DO $$
DECLARE q record;
BEGIN
  FOR q IN
    SELECT y.empresa_id, coalesce(l.normalized_phone, private.normalizar_telefone(y.cliente_telefone)) AS fone,
           left(y.cliente_nome, 120) AS nome, y.customer_id, y.crm_lead_id
      FROM public.quotes y LEFT JOIN public.crm_leads l ON l.id = y.crm_lead_id
     WHERE coalesce(l.normalized_phone, y.cliente_telefone) IS NOT NULL
  LOOP
    PERFORM private.mkt_upsert_contato(q.empresa_id, q.fone, q.nome, 'nao_comprador', NULL, NULL, NULL, NULL,
      'orcamento', q.customer_id, q.crm_lead_id);
  END LOOP;
END $$;

-- ================================================================ 3. dados das listas
-- Uma linha por contato da empresa, com as datas de cada família (calculadas na hora).
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
      mk.ultimo AS ultimo_marketing_em
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

-- O contato está no filtro? _f = {"ate": N, "de": M} (dias; sem "ate" = todos).
CREATE OR REPLACE FUNCTION private.mkt_no_intervalo(_dias int, _f jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT _dias IS NOT NULL
     AND _dias >= coalesce((_f ->> 'de')::int, 0)
     AND (_f ->> 'ate' IS NULL OR _dias <= (_f ->> 'ate')::int);
$$;

-- Famílias em que o contato entra, para os filtros pedidos (uma opção por família).
CREATE OR REPLACE FUNCTION private.mkt_familias(
  _filtros jsonb, _em_orcamento boolean, _dias_orcamento int, _em_conversa boolean, _dias_conversa int,
  _dias_cliente int, _perdido_preco_em timestamptz, _agendado_para date)
RETURNS text[] LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN _filtros ? 'orcamento' AND _em_orcamento
              AND private.mkt_no_intervalo(_dias_orcamento, _filtros -> 'orcamento') THEN 'orcamento' END,
    CASE WHEN _filtros ? 'conversa' AND _em_conversa
              AND private.mkt_no_intervalo(_dias_conversa, _filtros -> 'conversa') THEN 'conversa' END,
    CASE WHEN _filtros ? 'clientes'
              AND private.mkt_no_intervalo(_dias_cliente, _filtros -> 'clientes') THEN 'clientes' END,
    CASE WHEN _filtros ? 'perdido_preco' AND _perdido_preco_em >= now() - interval '90 days'
         THEN 'perdido_preco' END,
    CASE WHEN _filtros ? 'agendado' AND _agendado_para IS NOT NULL THEN 'agendado' END
  ], NULL);
$$;

-- Por que não pode receber agora (NULL = pode). Promoção: agendado e sem nome não recebem.
CREATE OR REPLACE FUNCTION private.mkt_motivo_fora(
  _promocao boolean, _limite int, _optout boolean, _interno boolean, _sem_pos_venda boolean,
  _agendado_para date, _primeiro_nome text, _ultimo_marketing_em timestamptz)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _optout THEN 'saiu das ofertas'
    WHEN _interno THEN 'contato interno da equipe'
    WHEN _sem_pos_venda THEN 'cliente marcado sem pós-venda'
    WHEN _promocao AND _agendado_para IS NOT NULL THEN 'tem serviço marcado'
    WHEN _promocao AND nullif(btrim(coalesce(_primeiro_nome, '')), '') IS NULL THEN 'sem nome'
    WHEN _ultimo_marketing_em > now() - make_interval(days => _limite)
      THEN 'recebeu marketing há ' || greatest(0, extract(day FROM now() - _ultimo_marketing_em)::int) || ' dias'
  END;
$$;

CREATE OR REPLACE FUNCTION private.mkt_limite_marketing(_emp uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT limite_marketing_dias FROM public.mkt_configuracoes WHERE empresa_id = _emp), 30)::int;
$$;

-- Quem está nos filtros (juntos sem repetir pessoa), com o motivo de quem não pode receber agora.
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
                        x.ultimo_marketing_em) AS motivo) m
  WHERE cardinality(f.fams) > 0;
$$;
REVOKE ALL ON FUNCTION private.mkt_publico(uuid, jsonb, boolean, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mkt_publico(uuid, jsonb, boolean, date) TO service_role;

-- ================================================================ 4. leitura pela tela
-- Só admin e atendente da empresa ativa (o técnico não vê marketing).
CREATE OR REPLACE FUNCTION private.mkt_empresa_marketing()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp uuid := private.empresa_ativa();
BEGIN
  IF emp IS NULL OR NOT (private.tem_papel('admin') OR private.tem_papel('atendente')) THEN
    RAISE EXCEPTION 'Sem acesso ao marketing desta empresa.' USING ERRCODE = '42501';
  END IF;
  RETURN emp;
END $$;
REVOKE ALL ON FUNCTION private.mkt_empresa_marketing() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.mkt_lista_publico(_filtros jsonb, _promocao boolean DEFAULT false)
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
  SELECT * FROM private.mkt_publico(private.mkt_empresa_marketing(), _filtros, _promocao, NULL)
  LIMIT 5000
$$;
REVOKE ALL ON FUNCTION public.mkt_lista_publico(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mkt_lista_publico(jsonb, boolean) TO authenticated, service_role;

-- Contagem de cada opção: _opcoes = {"chave": {"familia": {...filtro}}, ...}. Os dados são
-- calculados uma vez e cada opção é contada sobre eles.
CREATE OR REPLACE FUNCTION public.mkt_listas_contagem(_opcoes jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH emp AS (SELECT private.mkt_empresa_marketing() AS id),
  d AS MATERIALIZED (
    SELECT x.*, private.mkt_motivo_fora(false, private.mkt_limite_marketing(emp.id), x.optout, x.interno,
             x.sem_pos_venda, x.agendado_para, x.primeiro_nome, x.ultimo_marketing_em) IS NULL AS pode
      FROM emp, private.mkt_listas_dados(emp.id, NULL) x
  ), c AS (
    SELECT o.key AS k, count(d.contato_id) AS total, count(d.contato_id) FILTER (WHERE d.pode) AS podem
      FROM jsonb_each(CASE WHEN jsonb_typeof(_opcoes) = 'object' THEN _opcoes ELSE '{}'::jsonb END) o
      LEFT JOIN d ON cardinality(private.mkt_familias(o.value, d.em_orcamento, d.dias_orcamento, d.em_conversa,
                       d.dias_conversa, d.dias_cliente, d.perdido_preco_em, d.agendado_para)) > 0
     GROUP BY o.key
  )
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('total', total, 'podem', podem)), '{}'::jsonb) FROM c;
$$;
REVOKE ALL ON FUNCTION public.mkt_listas_contagem(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mkt_listas_contagem(jsonb) TO authenticated, service_role;

-- ================================================================ 5. modelos das listas novas
CREATE OR REPLACE FUNCTION private.mkt_modelo(_emp uuid, _finalidade text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(nullif(btrim((SELECT c.modelos ->> _finalidade FROM public.mkt_configuracoes c
                                  WHERE c.empresa_id = _emp)), ''),
    CASE _finalidade
      WHEN 'oferta' THEN 'oferta_trimestral'
      WHEN 'reativacao' THEN 'reativacao_cliente'
      WHEN 'orcamento' THEN 'orcamento_retomada'
      WHEN 'higienizacao_6m' THEN 'higienizacao_6meses'
      WHEN 'imper_13m' THEN 'imper_13meses'
      WHEN 'imper_13m_lembrete' THEN 'imper_13meses_lembrete'
      WHEN 'posvenda' THEN 'posvenda_resultado'
      WHEN 'sazonal_prefixo' THEN 'sazonal_'
      WHEN 'conversa' THEN 'conversa_retomada'
      WHEN 'preco' THEN 'preco_retomada'
    END);
$function$;
UPDATE public.mkt_configuracoes
   SET modelos = modelos || '{"conversa": "tc_conversa_retomada", "preco": "tc_preco_retomada"}'::jsonb
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND modelos <> '{}'::jsonb
   AND NOT modelos ? 'conversa';
