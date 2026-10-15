-- Origem certa (fase 2 da repaginada).
--  1) Lead sem origem que chegou com clique do Google (gclid ou gbraid, dos Leads do site) vira
--     "Google" na hora, como origem automática. Vale para lead novo e para quando o gclid chega
--     depois (a leitura da planilha preenche gclid/gbraid no lead já existente).
--  2) Ao ligar lead e OS (private.converter_lead_em_os, usada pelo orçamento e pelo vínculo
--     automático), a origem é copiada para o lado que está vazio. Nunca sobrescreve.
--  3) Correção única dos dados já existentes, pelas mesmas duas regras (idempotente).
-- Nada aqui apaga dados nem manda mensagem.

-- ---------------------------------------------------------------- 1) gclid/gbraid → Google
CREATE OR REPLACE FUNCTION private.origem_google(_empresa uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM public.config_options
   WHERE empresa_id = _empresa AND kind = 'sales_origin' AND active
     AND (metadata->>'codigo' = 'google' OR lower(name) = 'google')
   ORDER BY (metadata->>'codigo' = 'google') DESC, display_order LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.origem_google(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.crm_lead_origem_por_clique()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  google uuid;
BEGIN
  IF NEW.sales_origin_id IS NULL AND (NEW.gclid IS NOT NULL OR NEW.gbraid IS NOT NULL) THEN
    google := private.origem_google(NEW.empresa_id);
    IF google IS NOT NULL THEN
      NEW.sales_origin_id := google;
      NEW.origem_automatica := true;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.crm_lead_origem_por_clique() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_crm_leads_origem_por_clique
  BEFORE INSERT OR UPDATE OF gclid, gbraid, sales_origin_id ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION private.crm_lead_origem_por_clique();

-- ---------------------------------------------------------------- 2) copiar a origem ao ligar
-- Mesma função de 20260929120000, só com a cópia da origem no fim.
CREATE OR REPLACE FUNCTION private.converter_lead_em_os(_lead_id uuid, _work_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.crm_leads;
  convertido public.config_options;
  origem_os uuid;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = _lead_id FOR UPDATE;
  IF l.id IS NULL OR l.linked_work_order_id IS NOT NULL THEN RETURN; END IF;
  SELECT sales_origin_id INTO origem_os FROM public.work_orders
   WHERE id = _work_order_id AND empresa_id = l.empresa_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO convertido FROM public.config_options
   WHERE empresa_id = l.empresa_id AND kind = 'crm_status' AND active
     AND coalesce((metadata->>'closed')::boolean, false)
     AND NOT coalesce((metadata->>'lost')::boolean, false)
   ORDER BY display_order, name LIMIT 1;

  UPDATE public.crm_leads
     SET linked_work_order_id = _work_order_id, is_open = false,
         closed_at = coalesce(closed_at, now()), last_interaction_at = now(),
         next_follow_up_at = NULL, status_id = coalesce(convertido.id, status_id),
         -- Origem: o lado vazio recebe a do outro; os dois preenchidos ficam como estão.
         sales_origin_id = coalesce(sales_origin_id, origem_os),
         origem_automatica = CASE WHEN sales_origin_id IS NULL AND origem_os IS NOT NULL
                                  THEN true ELSE origem_automatica END
   WHERE id = l.id;
  IF origem_os IS NULL AND l.sales_origin_id IS NOT NULL THEN
    UPDATE public.work_orders SET sales_origin_id = l.sales_origin_id WHERE id = _work_order_id;
  END IF;

  IF convertido.id IS NOT NULL AND l.status_id IS DISTINCT FROM convertido.id THEN
    INSERT INTO public.crm_status_history (empresa_id, crm_lead_id, previous_status_id, new_status_id,
      previous_status_name, new_status_name, changed_by, change_source, notes)
    VALUES (l.empresa_id, l.id, l.status_id, convertido.id,
      (SELECT name FROM public.config_options WHERE id = l.status_id), convertido.name,
      auth.uid(), 'Orçamento', 'Lead convertido em OS a partir do orçamento.');
  END IF;
END $$;

-- ---------------------------------------------------------------- 3) dados já existentes
-- Leads sem origem com clique do Google (hoje: 1 na Turbine).
UPDATE public.crm_leads l
   SET sales_origin_id = private.origem_google(l.empresa_id), origem_automatica = true
 WHERE l.sales_origin_id IS NULL AND (l.gclid IS NOT NULL OR l.gbraid IS NOT NULL)
   AND private.origem_google(l.empresa_id) IS NOT NULL;
-- Leads ligados a uma OS com origem, mas sem a sua (hoje: 2 na Turbine).
UPDATE public.crm_leads l
   SET sales_origin_id = w.sales_origin_id, origem_automatica = true
  FROM public.work_orders w
 WHERE w.id = l.linked_work_order_id AND l.sales_origin_id IS NULL AND w.sales_origin_id IS NOT NULL;
-- OS sem origem ligadas a um lead com origem (hoje: nenhuma).
UPDATE public.work_orders w
   SET sales_origin_id = l.sales_origin_id
  FROM public.crm_leads l
 WHERE l.linked_work_order_id = w.id AND w.sales_origin_id IS NULL AND l.sales_origin_id IS NOT NULL;
