-- OS de teste (fase 2 da repaginada): uma OS marcada como teste fica fora dos números (painel do
-- Início, DRE, Origens, A receber) e da exportação de conversões para o Google Ads. Nada é
-- apagado: a OS continua existindo, só não conta.
--  * Padrão falso: nenhuma OS existente muda de comportamento até alguém marcar.
--  * A view das conversões pendentes é a mesma de 20261108120000, só ignorando OS de teste
--    (vw_conversoes_google lê dela e não muda).
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS eh_teste boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.work_orders.eh_teste IS
  'OS de teste: não conta nos números nem vai para o Google Ads.';

CREATE OR REPLACE VIEW public.vw_conversoes_google_pendentes WITH (security_invoker = true) AS
SELECT DISTINCT ON (a.crm_lead_id)
       a.id AS ads_click_id,
       a.empresa_id,
       a.crm_lead_id,
       a.gclid,
       CASE coalesce(a.servico,
                     CASE WHEN l.service_interest ILIKE '%imper%' THEN 'impermeabilizacao' END,
                     'higienizacao')
         WHEN 'impermeabilizacao' THEN 'Venda Impermeabilização'
         ELSE 'Venda Higienização'
       END AS conversao_nome,
       greatest(coalesce(l.os_criada_em, w.created_at), a.created_at + interval '1 minute') AS conversao_em,
       to_char(greatest(coalesce(l.os_criada_em, w.created_at), a.created_at + interval '1 minute')
                 AT TIME ZONE 'America/Sao_Paulo',
               'YYYY-MM-DD HH24:MI:SS') || '-03:00' AS conversao_horario,
       w.total_gross_value AS valor
  FROM public.ads_clicks a
  JOIN public.crm_leads l ON l.id = a.crm_lead_id AND l.empresa_id = a.empresa_id
  JOIN public.work_orders w ON w.id = l.linked_work_order_id AND w.empresa_id = l.empresa_id
                            AND w.deleted_at IS NULL
                            AND w.status IS DISTINCT FROM 'Cancelada'
                            AND NOT w.eh_teste
 WHERE a.gclid IS NOT NULL
   AND a.enviado_google_em IS NULL
   AND a.created_at <= coalesce(l.os_criada_em, w.created_at) + interval '1 day'
   AND coalesce(l.os_criada_em, w.created_at) < a.created_at + interval '90 days'
   AND NOT EXISTS (SELECT 1 FROM public.ads_clicks x
                    WHERE x.crm_lead_id = a.crm_lead_id AND x.enviado_google_em IS NOT NULL)
 ORDER BY a.crm_lead_id, a.created_at DESC;
