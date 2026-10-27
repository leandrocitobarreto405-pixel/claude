-- Pop-up das LPs ligado ao lead pelo código (27/10/2026, aprovado).
-- 1. ads_clicks.ref_code: código curto que o pop-up põe no fim da mensagem do WhatsApp,
--    "(cód. XXXXX)". Liga o clique (gclid) ao lead mesmo quando o cliente digitou outro telefone no
--    pop-up; a venda entra na exportação para o Google Ads (que lê o clique ligado ao lead).
-- 2. mensagens_origem.exige_popup: frases das LPs que só deveriam chegar depois do pop-up.
-- 3. crm_leads.lp_sem_popup_em: lead que chegou com frase de LP e sem registro do pop-up (para medir
--    o vazamento por semana). Sai quando o clique é ligado depois.
-- Só colunas, funções e gatilhos novos; a ligação por telefone continua igual.

ALTER TABLE public.ads_clicks ADD COLUMN IF NOT EXISTS ref_code text
  CHECK (ref_code IS NULL OR ref_code ~ '^[A-Z0-9]{4,8}$');
CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_clicks_ref ON public.ads_clicks (empresa_id, ref_code)
  WHERE ref_code IS NOT NULL;
ALTER TABLE public.mensagens_origem ADD COLUMN IF NOT EXISTS exige_popup boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS lp_sem_popup_em timestamptz;
CREATE INDEX IF NOT EXISTS idx_crm_leads_lp_sem_popup ON public.crm_leads (empresa_id, lp_sem_popup_em)
  WHERE lp_sem_popup_em IS NOT NULL;

-- Código no fim da mensagem: "(cód. 4F2KQ)" (aceita "cod", com ou sem ponto).
CREATE OR REPLACE FUNCTION private.ads_ref_da_mensagem(_texto text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT upper((regexp_match(coalesce(_texto, ''), '\(\s*c[oó]d\.?\s*([A-Za-z0-9]{4,8})\s*\)\s*$'))[1]);
$$;

-- Liga o clique do código ao lead (se ainda não estiver ligado a outro).
CREATE OR REPLACE FUNCTION private.ads_ligar_por_codigo(_emp uuid, _ref text, _lead uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE clique uuid;
BEGIN
  IF _ref IS NULL OR _lead IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO clique FROM public.ads_clicks
   WHERE empresa_id = _emp AND ref_code = _ref AND (crm_lead_id IS NULL OR crm_lead_id = _lead)
   FOR UPDATE;
  IF clique IS NULL THEN RETURN NULL; END IF;
  UPDATE public.ads_clicks SET crm_lead_id = _lead, vinculado_em = coalesce(vinculado_em, now())
   WHERE id = clique AND crm_lead_id IS NULL;
  IF FOUND THEN
    INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, ads_click_id, detalhe)
    VALUES (_emp, 'vinculo', 'vinculado', clique, jsonb_build_object('crm_lead_id', _lead, 'origem', 'codigo'));
  END IF;
  RETURN clique;
END $$;
REVOKE ALL ON FUNCTION private.ads_ligar_por_codigo(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Mensagem do cliente: liga pelo código; primeira mensagem com frase de LP e sem pop-up → marca.
CREATE OR REPLACE FUNCTION private.ads_mensagem_lp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ref text;
  lead uuid := NEW.crm_lead_id;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'Recebida' OR coalesce(NEW.privada, false) THEN RETURN NEW; END IF;
  IF lead IS NULL AND NEW.conversa_id IS NOT NULL THEN
    SELECT crm_lead_id INTO lead FROM public.conversas WHERE id = NEW.conversa_id;
  END IF;
  IF lead IS NULL THEN RETURN NEW; END IF;
  ref := private.ads_ref_da_mensagem(NEW.text_content);
  IF ref IS NOT NULL THEN
    PERFORM private.ads_ligar_por_codigo(NEW.empresa_id, ref, lead);
  END IF;
  -- Só a primeira mensagem do cliente no lead conta para "LP sem pop-up".
  IF EXISTS (SELECT 1 FROM public.whatsapp_messages w
              WHERE w.crm_lead_id = lead AND w.direction = 'Recebida' AND NOT coalesce(w.privada, false)
                AND w.id <> NEW.id
                AND coalesce(w.message_timestamp, w.created_at) < coalesce(NEW.message_timestamp, NEW.created_at)) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.mensagens_origem m
              WHERE m.empresa_id = NEW.empresa_id AND m.ativo AND m.exige_popup
                AND position(private.texto_busca(m.texto) IN private.texto_busca(coalesce(NEW.text_content, ''))) > 0)
     AND NOT EXISTS (SELECT 1 FROM public.ads_clicks a WHERE a.crm_lead_id = lead)
     AND NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = lead AND (l.gclid IS NOT NULL OR l.lp_origem IS NOT NULL)) THEN
    UPDATE public.crm_leads SET lp_sem_popup_em = coalesce(NEW.message_timestamp, now())
     WHERE id = lead AND lp_sem_popup_em IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.ads_mensagem_lp() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_whatsapp_messages_ads_lp
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION private.ads_mensagem_lp();
-- Mensagem gravada antes de ganhar o lead: confere quando o lead é ligado.
CREATE OR REPLACE TRIGGER trg_whatsapp_messages_ads_lp_lead
  AFTER UPDATE OF crm_lead_id ON public.whatsapp_messages
  FOR EACH ROW WHEN (OLD.crm_lead_id IS NULL AND NEW.crm_lead_id IS NOT NULL)
  EXECUTE FUNCTION private.ads_mensagem_lp();

-- Clique ligado depois (registro atrasado, código ou telefone): o lead deixa de ser "sem pop-up".
CREATE OR REPLACE FUNCTION private.ads_clique_ligado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.crm_leads SET lp_sem_popup_em = NULL WHERE id = NEW.crm_lead_id AND lp_sem_popup_em IS NOT NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.ads_clique_ligado() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_ads_clicks_ligado
  AFTER INSERT OR UPDATE OF crm_lead_id ON public.ads_clicks
  FOR EACH ROW WHEN (NEW.crm_lead_id IS NOT NULL)
  EXECUTE FUNCTION private.ads_clique_ligado();

-- Registro do pop-up com código (servidor): grava o código no clique e, se a mensagem já chegou
-- (registro atrasado), liga na hora.
CREATE OR REPLACE FUNCTION public.ads_definir_ref(_clique uuid, _ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.ads_clicks;
  lead uuid;
BEGIN
  IF _ref IS NULL OR _ref !~ '^[A-Z0-9]{4,8}$' THEN RETURN jsonb_build_object('resultado', 'ref_invalido'); END IF;
  SELECT * INTO c FROM public.ads_clicks WHERE id = _clique;
  IF c.id IS NULL THEN RETURN jsonb_build_object('resultado', 'sem_clique'); END IF;
  IF EXISTS (SELECT 1 FROM public.ads_clicks WHERE empresa_id = c.empresa_id AND ref_code = _ref AND id <> c.id) THEN
    RETURN jsonb_build_object('resultado', 'ref_repetido');
  END IF;
  UPDATE public.ads_clicks SET ref_code = _ref WHERE id = c.id;
  SELECT coalesce(w.crm_lead_id, cv.crm_lead_id) INTO lead
    FROM public.whatsapp_messages w LEFT JOIN public.conversas cv ON cv.id = w.conversa_id
   WHERE w.empresa_id = c.empresa_id AND w.direction = 'Recebida'
     AND w.created_at >= c.created_at - interval '1 day'
     AND private.ads_ref_da_mensagem(w.text_content) = _ref
   ORDER BY w.created_at LIMIT 1;
  IF lead IS NOT NULL THEN PERFORM private.ads_ligar_por_codigo(c.empresa_id, _ref, lead); END IF;
  RETURN jsonb_build_object('resultado', 'ok', 'ligado', lead IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.ads_definir_ref(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ads_definir_ref(uuid, text) TO service_role;

-- As três frases das LPs da Turbine (pop-up obrigatório).
UPDATE public.mensagens_origem SET exige_popup = true
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
   AND private.texto_busca(texto) IN (
     private.texto_busca('Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.'),
     private.texto_busca('Olá, gostaria de um orçamento para higienização do meu colchão, por favor.'),
     private.texto_busca('Olá! Gostaria de saber mais sobre a impermeabilização de estofados.'));
