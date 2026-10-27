-- Conversões otimizadas para leads na planilha do Google Ads (27/10/2026, aprovado).
-- 1. ads_conversoes_google: uma linha por venda (OS) exportada, com o nome e o horário de conversão
--    FIXOS (a mesma venda nunca muda de nome/horário, o Google não conta de novo), os identificadores
--    do clique (gclid, gbraid, wbraid) e o e-mail/telefone já em SHA-256 (nada em claro guardado).
-- 2. vw_conversoes_google_candidatas: vendas que ainda não estão na tabela e entram na planilha:
--    (a) lead com clique de anúncio (gclid/gbraid/wbraid) dentro da janela de sempre; ou
--    (b) sem clique gravado, mas lead de origem Google Ads (landing, botão de WhatsApp do anúncio)
--        ou com a frase da landing na mensagem. Cliente da base / recompra fica fora em (b).
-- A visão antiga (vw_conversoes_google_pendentes) continua existindo.

CREATE TABLE IF NOT EXISTS public.ads_conversoes_google (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id),
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  ads_click_id uuid REFERENCES public.ads_clicks(id) ON DELETE SET NULL,
  gclid text,
  gbraid text,
  wbraid text,
  email_sha256 text CHECK (email_sha256 IS NULL OR email_sha256 ~ '^[0-9a-f]{64}$'),
  telefone_sha256 text CHECK (telefone_sha256 IS NULL OR telefone_sha256 ~ '^[0-9a-f]{64}$'),
  conversao_nome text NOT NULL,
  conversao_horario text NOT NULL CHECK (conversao_horario ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$'),
  valor numeric(12,2) NOT NULL,
  base text NOT NULL CHECK (base IN ('clique', 'origem')),
  exportada_em timestamptz,
  retirada_em timestamptz,
  motivo_retirada text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, work_order_id),
  CHECK (gclid IS NOT NULL OR gbraid IS NOT NULL OR wbraid IS NOT NULL
         OR email_sha256 IS NOT NULL OR telefone_sha256 IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ads_conversoes_google_empresa ON public.ads_conversoes_google (empresa_id, created_at DESC);
ALTER TABLE public.ads_conversoes_google ENABLE ROW LEVEL SECURITY;
-- Só leitura pela tela (admin da empresa); quem grava é a exportação (chave de serviço).
CREATE POLICY ads_conversoes_google_ver ON public.ads_conversoes_google FOR SELECT TO authenticated
  USING (empresa_id = private.empresa_ativa() AND private.tem_papel('admin'));
GRANT SELECT ON public.ads_conversoes_google TO authenticated;

CREATE OR REPLACE VIEW public.vw_conversoes_google_candidatas
WITH (security_invoker = true) AS
WITH os AS (
  SELECT w.id AS work_order_id, w.empresa_id, w.customer_id, w.total_gross_value AS valor,
         l.id AS crm_lead_id, l.service_interest, l.sales_origin_id,
         coalesce(l.os_criada_em, w.created_at) AS venda_em,
         coalesce(nullif(l.normalized_phone, ''), nullif(c.phone, '')) AS telefone,
         nullif(trim(c.email), '') AS email,
         so.name AS origem_os, lo.name AS origem_lead
    FROM public.work_orders w
    JOIN public.crm_leads l ON l.linked_work_order_id = w.id AND l.empresa_id = w.empresa_id
    LEFT JOIN public.customers c ON c.id = w.customer_id
    LEFT JOIN public.config_options so ON so.id = w.sales_origin_id
    LEFT JOIN public.config_options lo ON lo.id = l.sales_origin_id
   WHERE w.deleted_at IS NULL AND w.status IS DISTINCT FROM 'Cancelada' AND NOT w.eh_teste
     AND NOT EXISTS (SELECT 1 FROM public.ads_conversoes_google g WHERE g.work_order_id = w.id)
), clique AS (
  SELECT DISTINCT ON (o.work_order_id) o.work_order_id, a.id AS ads_click_id, a.gclid, a.gbraid, a.wbraid,
         a.servico, a.created_at AS clique_em
    FROM os o
    JOIN public.ads_clicks a ON a.crm_lead_id = o.crm_lead_id
   WHERE (a.gclid IS NOT NULL OR a.gbraid IS NOT NULL OR a.wbraid IS NOT NULL)
     AND a.created_at <= o.venda_em + interval '1 day'
     AND o.venda_em < a.created_at + interval '90 days'
   ORDER BY o.work_order_id, (a.gclid IS NOT NULL) DESC, a.created_at DESC
)
SELECT o.empresa_id, o.work_order_id, o.crm_lead_id, k.ads_click_id, k.gclid,
       CASE WHEN k.gclid IS NULL THEN k.gbraid END AS gbraid,
       CASE WHEN k.gclid IS NULL AND k.gbraid IS NULL THEN k.wbraid END AS wbraid,
       o.telefone, o.email,
       CASE coalesce(k.servico, CASE WHEN o.service_interest ILIKE '%imper%' THEN 'impermeabilizacao' END, 'higienizacao')
         WHEN 'impermeabilizacao' THEN 'Venda Impermeabilização' ELSE 'Venda Higienização' END AS conversao_nome,
       to_char((CASE WHEN k.clique_em IS NOT NULL THEN greatest(o.venda_em, k.clique_em + interval '1 minute')
                     ELSE o.venda_em END) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') || '-03:00'
         AS conversao_horario,
       coalesce(o.valor, 0) AS valor,
       CASE WHEN k.work_order_id IS NOT NULL THEN 'clique' ELSE 'origem' END AS base,
       o.venda_em
  FROM os o
  LEFT JOIN clique k ON k.work_order_id = o.work_order_id
 WHERE o.venda_em > now() - interval '90 days'
   AND (k.work_order_id IS NOT NULL
        OR (
          -- sem clique gravado: origem Google Ads ou frase da landing, e não é cliente da base
          (o.origem_os ILIKE 'Google Ads%' OR o.origem_lead ILIKE 'Google Ads%'
           OR EXISTS (SELECT 1 FROM public.whatsapp_messages m
                        JOIN public.mensagens_origem mo ON mo.empresa_id = m.empresa_id AND mo.exige_popup
                       WHERE m.crm_lead_id = o.crm_lead_id AND m.direction = 'Recebida'
                         AND position(private.texto_busca(mo.texto) IN private.texto_busca(coalesce(m.text_content, ''))) > 0))
          AND coalesce(o.origem_os, '') NOT ILIKE 'Cliente existente%'
          AND coalesce(o.origem_lead, '') NOT ILIKE 'Cliente existente%'
          AND NOT EXISTS (SELECT 1 FROM public.work_orders w2
                           WHERE w2.customer_id = o.customer_id AND w2.id <> o.work_order_id
                             AND w2.deleted_at IS NULL AND w2.created_at < o.venda_em)
          AND (o.telefone IS NOT NULL OR o.email IS NOT NULL)));
REVOKE ALL ON public.vw_conversoes_google_candidatas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_conversoes_google_candidatas TO service_role;

SELECT private.instalar_travas_somente_leitura();
