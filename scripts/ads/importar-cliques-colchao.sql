-- Script ÚNICO (não é rotina): importa para ads_clicks os cadastros da LP do colchão que ficaram
-- só na planilha "Leads - Higienização de Colchão SP" (aba "Leads") enquanto o domínio
-- turbinecleancolchao.lovable.app não estava liberado (06 a 12/10/2026).
--
-- Fonte: as linhas da planilha que o app já lê a cada 5 minutos (Leads do site, tabela
-- leads_site, planilha "LP Colchão SP"), com todas as colunas (Data e Hora, Nome, WhatsApp,
-- Serviço, utm_*, gclid, gbraid, wbraid, fbclid, Link da Página). O token da conta Google não sai
-- do servidor, por isso o script lê a cópia do app, não a planilha direto.
--
-- Regras (as mesmas do endpoint /api/public/ads/lead):
--  * só linhas com gclid válido e página turbinecleancolchao.lovable.app (pula localhost/testes);
--  * created_at = data e hora da planilha; telefone com private.normalizar_telefone;
--  * pula gclid que já existe em ads_clicks (rodar de novo não duplica);
--  * depois liga cada clique ao lead do CRM pelo telefone (9º dígito pela chave) e marca o
--    WhatsApp iniciado pela primeira mensagem recebida, como faz o banco nos cliques normais.
-- Rodar com a chave de serviço (SQL Editor ou MCP). Devolve quantos entraram e quantos ligaram.

WITH origem AS (
  SELECT DISTINCT ON (s.gclid) s.*
    FROM public.leads_site s
    JOIN public.leads_site_planilhas p ON p.id = s.planilha_id
   WHERE p.empresa_id = '11111111-1111-1111-1111-111111111111'
     AND p.nome = 'LP Colchão SP'
     AND s.gclid ~ '^[A-Za-z0-9._-]+$' AND length(s.gclid) BETWEEN 4 AND 600
     AND s.pagina ILIKE '%turbinecleancolchao.lovable.app%'
     AND s.pagina NOT ILIKE '%localhost%'
     AND private.normalizar_telefone(s.telefone_digitado) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ads_clicks a WHERE a.gclid = s.gclid)
   ORDER BY s.gclid, s.cadastrado_em
), novos AS (
  INSERT INTO public.ads_clicks (empresa_id, created_at, nome, telefone_raw, normalized_phone,
    gclid, gbraid, wbraid, fbclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    page_url, servico)
  SELECT p.empresa_id, o.cadastrado_em, private.ads_texto(o.nome, 120),
         private.ads_texto(o.telefone_digitado, 40), private.normalizar_telefone(o.telefone_digitado),
         o.gclid,
         CASE WHEN o.gbraid ~ '^[A-Za-z0-9._-]+$' AND length(o.gbraid) BETWEEN 4 AND 600 THEN o.gbraid END,
         CASE WHEN o.wbraid ~ '^[A-Za-z0-9._-]+$' AND length(o.wbraid) BETWEEN 4 AND 600 THEN o.wbraid END,
         CASE WHEN o.fbclid ~ '^[A-Za-z0-9._-]+$' AND length(o.fbclid) BETWEEN 4 AND 600 THEN o.fbclid END,
         private.ads_texto(o.utm_source, 300), private.ads_texto(o.utm_medium, 300),
         private.ads_texto(o.utm_campaign, 300), private.ads_texto(o.utm_term, 300),
         private.ads_texto(o.utm_content, 300), private.ads_texto(o.pagina, 2000),
         CASE WHEN lower(o.servico) LIKE '%imper%' THEN 'impermeabilizacao' ELSE 'higienizacao' END
    FROM origem o
    JOIN public.leads_site_planilhas p ON p.id = o.planilha_id
  RETURNING id, empresa_id, normalized_phone, created_at
), registro AS (
  INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, ads_click_id, detalhe)
  SELECT empresa_id, 'captacao', 'importado', id,
         jsonb_build_object('origem', 'planilha LP Colchão SP (script único)')
    FROM novos
  RETURNING ads_click_id
)
SELECT count(*) AS importados FROM registro;

-- Vínculo com o CRM: lead com o mesmo telefone (chave sem o 9º dígito), o mais recente.
WITH ligar AS (
  SELECT a.id AS clique, (
           SELECT l.id FROM public.crm_leads l
            WHERE l.empresa_id = a.empresa_id
              AND private.telefone_chave(l.normalized_phone) = private.telefone_chave(a.normalized_phone)
            ORDER BY coalesce(l.last_interaction_at, l.created_at) DESC
            LIMIT 1) AS lead, a.empresa_id
    FROM public.ads_clicks a
   WHERE a.crm_lead_id IS NULL
     AND EXISTS (SELECT 1 FROM public.ads_eventos e
                  WHERE e.ads_click_id = a.id AND e.tipo = 'captacao' AND e.resultado = 'importado')
), feitos AS (
  UPDATE public.ads_clicks a SET crm_lead_id = g.lead, vinculado_em = now()
    FROM ligar g WHERE a.id = g.clique AND g.lead IS NOT NULL
  RETURNING a.id, a.empresa_id, a.crm_lead_id
), registro AS (
  INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, ads_click_id, detalhe)
  SELECT empresa_id, 'vinculo', 'vinculado', id,
         jsonb_build_object('crm_lead_id', crm_lead_id, 'origem', 'importação da planilha')
    FROM feitos
  RETURNING ads_click_id
)
SELECT count(*) AS vinculados FROM registro;

-- WhatsApp iniciado: primeira mensagem recebida do mesmo telefone a partir de 10 min antes do
-- clique (mesma regra do gatilho de whatsapp_messages).
UPDATE public.ads_clicks a SET whatsapp_iniciado_em = m.primeira
  FROM (
    SELECT a2.id, min(coalesce(w.message_timestamp, w.created_at)) AS primeira
      FROM public.ads_clicks a2
      JOIN public.whatsapp_contacts c ON c.empresa_id = a2.empresa_id
       AND private.telefone_chave(c.normalized_phone) = private.telefone_chave(a2.normalized_phone)
      JOIN public.whatsapp_messages w ON w.whatsapp_contact_id = c.id AND w.direction = 'Recebida'
       AND coalesce(w.message_timestamp, w.created_at) >= a2.created_at - interval '10 minutes'
     WHERE a2.whatsapp_iniciado_em IS NULL
       AND EXISTS (SELECT 1 FROM public.ads_eventos e
                    WHERE e.ads_click_id = a2.id AND e.tipo = 'captacao' AND e.resultado = 'importado')
     GROUP BY a2.id
  ) m
 WHERE a.id = m.id;
