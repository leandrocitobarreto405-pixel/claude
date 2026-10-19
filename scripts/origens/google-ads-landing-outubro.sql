-- Landing do Google Ads (Turbine, leads de outubro/2026). Aprovado em 19/10. Rodar numa transação.
--  * Lead hoje em "Google" automático que veio pelo pop-up (gclid/gbraid) ou cuja primeira
--    mensagem recebida contém o texto de uma das landing pages → "Google Ads – landing".
--    Origem escolhida à mão (origem_automatica = false) não muda. Os do botão não entram.
--  * A OS ligada que estava com "Google" acompanha.
--  * Os 3 textos das landing pages passam a dar "Google Ads – landing" (campanha mantida).

CREATE TEMP TABLE _lp ON COMMIT DROP AS
SELECT private.texto_busca(t) AS t FROM (VALUES
  ('Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.'),
  ('Olá, gostaria de um orçamento para higienização do meu colchão, por favor.'),
  ('Olá! Gostaria de saber mais sobre a impermeabilização de estofados.')) v(t);

CREATE TEMP TABLE _alvo ON COMMIT DROP AS
SELECT l.id, l.sales_origin_id AS origem_antiga, l.linked_work_order_id,
       (l.gclid IS NOT NULL OR l.gbraid IS NOT NULL) AS clique
  FROM public.crm_leads l
  JOIN public.config_options o ON o.id = l.sales_origin_id AND o.metadata->>'codigo' = 'google'
  LEFT JOIN LATERAL (
    SELECT m.text_content FROM public.whatsapp_messages m
     WHERE m.crm_lead_id = l.id AND m.direction = 'Recebida' AND NOT m.privada
     ORDER BY m.message_timestamp, m.created_at LIMIT 1) p ON true
 WHERE l.empresa_id = '11111111-1111-1111-1111-111111111111'
   AND l.created_at >= '2026-10-01 00:00:00-03' AND l.created_at < '2026-11-01 00:00:00-03'
   AND l.origem_automatica
   AND (l.gclid IS NOT NULL OR l.gbraid IS NOT NULL
        OR EXISTS (SELECT 1 FROM _lp WHERE position(_lp.t IN private.texto_busca(p.text_content)) > 0));

UPDATE public.crm_leads l
   SET sales_origin_id = private.origem_por_codigo(l.empresa_id, 'google_ads_landing'),
       origem_automatica = true
  FROM _alvo a WHERE l.id = a.id;

CREATE TEMP TABLE _os ON COMMIT DROP AS
SELECT w.id, w.os_number FROM public.work_orders w JOIN _alvo a ON a.linked_work_order_id = w.id
 WHERE w.sales_origin_id = a.origem_antiga;

UPDATE public.work_orders w
   SET sales_origin_id = private.origem_por_codigo(w.empresa_id, 'google_ads_landing')
  FROM _os x WHERE w.id = x.id;

UPDATE public.mensagens_origem m
   SET sales_origin_id = private.origem_por_codigo(m.empresa_id, 'google_ads_landing')
 WHERE m.empresa_id = '11111111-1111-1111-1111-111111111111'
   AND private.texto_busca(m.texto) IN (SELECT t FROM _lp);

CREATE TEMP TABLE _resultado_landing AS
SELECT (SELECT count(*) FROM _alvo WHERE clique) AS leads_popup,
       (SELECT count(*) FROM _alvo WHERE NOT clique) AS leads_texto_lp,
       (SELECT string_agg(os_number, ', ' ORDER BY os_number) FROM _os) AS os,
       (SELECT count(*) FROM public.mensagens_origem m
         WHERE m.empresa_id = '11111111-1111-1111-1111-111111111111'
           AND private.texto_busca(m.texto) IN (SELECT t FROM _lp)
           AND m.sales_origin_id = private.origem_por_codigo(m.empresa_id, 'google_ads_landing')) AS textos_lp;
