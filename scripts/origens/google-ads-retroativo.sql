-- Retroativo (Turbine, leads desde 01/10/2026). Rodar dentro de uma transação.
--  * Botão WhatsApp: primeira mensagem recebida igual ao texto do anúncio (sem acento,
--    maiúscula e pontuação) e origem vazia ou automática → "Google Ads – botão WhatsApp",
--    serviço "Higienização" se vazio. A OS ligada que estava com a mesma origem antiga (ou sem
--    origem) acompanha.
--  * Landing: lead com clique do pop-up (ads_clicks com gclid) e sem origem → "Google Ads – landing".
-- Origem escolhida à mão (origem_automatica = false) não muda.

CREATE TEMP TABLE _botao ON COMMIT DROP AS
SELECT l.id, l.sales_origin_id AS origem_antiga, l.linked_work_order_id
  FROM public.crm_leads l
  JOIN LATERAL (
    SELECT m.text_content FROM public.whatsapp_messages m
     WHERE m.crm_lead_id = l.id AND m.direction = 'Recebida' AND NOT m.privada
     ORDER BY m.message_timestamp, m.created_at LIMIT 1) p ON true
 WHERE l.empresa_id = '11111111-1111-1111-1111-111111111111'
   AND l.created_at >= '2026-10-01 00:00:00-03'
   AND private.texto_busca(p.text_content)
       = private.texto_busca('Olá, vim do google e gostaria de mais informações!')
   AND (l.sales_origin_id IS NULL OR l.origem_automatica);

UPDATE public.crm_leads l
   SET sales_origin_id = private.origem_por_codigo(l.empresa_id, 'google_ads_whatsapp'),
       origem_automatica = true,
       service_interest = coalesce(nullif(l.service_interest, ''), 'Higienização')
  FROM _botao b WHERE l.id = b.id;

UPDATE public.work_orders w
   SET sales_origin_id = private.origem_por_codigo(w.empresa_id, 'google_ads_whatsapp')
  FROM _botao b
 WHERE w.id = b.linked_work_order_id
   AND (w.sales_origin_id IS NULL OR w.sales_origin_id = b.origem_antiga);

CREATE TEMP TABLE _landing ON COMMIT DROP AS
SELECT l.id FROM public.crm_leads l
 WHERE l.empresa_id = '11111111-1111-1111-1111-111111111111'
   AND l.created_at >= '2026-10-01 00:00:00-03'
   AND l.sales_origin_id IS NULL
   AND EXISTS (SELECT 1 FROM public.ads_clicks a WHERE a.crm_lead_id = l.id AND a.gclid IS NOT NULL);

UPDATE public.crm_leads l
   SET sales_origin_id = private.origem_por_codigo(l.empresa_id, 'google_ads_landing'),
       origem_automatica = true
  FROM _landing x WHERE l.id = x.id;

CREATE TEMP TABLE _resultado_origem AS
SELECT (SELECT count(*) FROM _botao) AS botao_leads,
       (SELECT count(*) FROM _botao WHERE linked_work_order_id IS NOT NULL) AS botao_com_os,
       (SELECT string_agg(w.os_number, ', ' ORDER BY w.os_number) FROM _botao b
          JOIN public.work_orders w ON w.id = b.linked_work_order_id) AS os,
       (SELECT count(*) FROM _landing) AS landing_leads;
