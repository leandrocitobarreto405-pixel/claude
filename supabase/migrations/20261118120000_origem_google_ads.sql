-- Origem dos leads do Google Ads (Turbine):
--  * "Google Ads – botão WhatsApp": o recurso de mensagem do anúncio manda o texto
--    "Olá, vim do google e gostaria de mais informações!" (sem gclid e sem pop-up). Fica
--    cadastrado como mensagem pronta (mensagens_origem): a primeira mensagem do lead com esse
--    texto (sem acento/maiúscula/pontuação) dá a origem e o serviço "Higienização" se vazio.
--  * "Google Ads – landing": lead que veio pelo pop-up (gclid) e está sem origem recebe esta
--    origem pelo gatilho do clique (antes recebia "Google"; empresa sem essa origem continua
--    com "Google").
-- Nada é apagado; a view vw_conversoes_google e ads_clicks não mudam.

-- 1. Origens (Turbine), se ainda não existirem.
INSERT INTO public.config_options (empresa_id, kind, name, active, display_order, metadata)
SELECT e.id, 'sales_origin', v.nome, true, 1,
       jsonb_build_object('codigo', v.codigo, 'palavras', '[]'::jsonb)
  FROM public.empresas e
 CROSS JOIN (VALUES ('Google Ads – botão WhatsApp', 'google_ads_whatsapp'),
                    ('Google Ads – landing', 'google_ads_landing')) v(nome, codigo)
 WHERE e.id = '11111111-1111-1111-1111-111111111111'
   AND NOT EXISTS (SELECT 1 FROM public.config_options o
                    WHERE o.empresa_id = e.id AND o.kind = 'sales_origin'
                      AND (o.name = v.nome OR o.metadata->>'codigo' = v.codigo));

-- 2. Mensagem do botão do anúncio como mensagem pronta (mesmo mecanismo das outras).
INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id, servico, descricao)
SELECT o.empresa_id, 'Olá, vim do google e gostaria de mais informações!', o.id, 'Higienização',
       'Recurso de mensagem do anúncio do Google Ads (botão WhatsApp, sem gclid).'
  FROM public.config_options o
 WHERE o.empresa_id = '11111111-1111-1111-1111-111111111111' AND o.kind = 'sales_origin'
   AND o.metadata->>'codigo' = 'google_ads_whatsapp'
   AND NOT EXISTS (SELECT 1 FROM public.mensagens_origem m
                    WHERE m.empresa_id = o.empresa_id
                      AND private.texto_busca(m.texto)
                          = private.texto_busca('Olá, vim do google e gostaria de mais informações!'));

-- 3. Clique do pop-up (gclid/gbraid): "Google Ads – landing" quando a empresa tem essa origem.
CREATE OR REPLACE FUNCTION private.origem_por_codigo(_empresa uuid, _codigo text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM public.config_options
   WHERE empresa_id = _empresa AND kind = 'sales_origin' AND active
     AND metadata->>'codigo' = _codigo
   ORDER BY display_order LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.origem_por_codigo(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.crm_lead_origem_por_clique()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  google uuid;
BEGIN
  IF NEW.sales_origin_id IS NULL AND (NEW.gclid IS NOT NULL OR NEW.gbraid IS NOT NULL) THEN
    google := coalesce(private.origem_por_codigo(NEW.empresa_id, 'google_ads_landing'),
                       private.origem_google(NEW.empresa_id));
    IF google IS NOT NULL THEN
      NEW.sales_origin_id := google;
      NEW.origem_automatica := true;
    END IF;
  END IF;
  RETURN NEW;
END $$;
