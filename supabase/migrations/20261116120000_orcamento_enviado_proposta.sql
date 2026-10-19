-- Orçamento salvo = enviado: quando o orçamento passa a "enviado" (o app grava "enviado" ao salvar,
-- ao gerar a mensagem do WhatsApp e ao gerar a proposta), o lead aberto que ainda está antes da
-- etapa de orçamento (Novo contato, Aguardando atendimento, Em atendimento, Em negociação) vai
-- para o status "Orçamento enviado", com registro no histórico. Lead fechado ou já adiante não muda.
-- Proposta (documento sem OS): o orçamento guarda o último documento gerado.
-- Nada é apagado.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS proposta_documento_id text,
  ADD COLUMN IF NOT EXISTS proposta_url text,
  ADD COLUMN IF NOT EXISTS proposta_gerada_em timestamptz;

CREATE OR REPLACE FUNCTION private.lead_orcamento_enviado(_lead_id uuid, _nota text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.crm_leads;
  atual public.config_options;
  destino public.config_options;
BEGIN
  IF _lead_id IS NULL THEN RETURN; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = _lead_id FOR UPDATE;
  IF l.id IS NULL OR NOT l.is_open OR l.linked_work_order_id IS NOT NULL THEN RETURN; END IF;

  SELECT * INTO atual FROM public.config_options WHERE id = l.status_id;
  IF atual.id IS NOT NULL
     AND coalesce(atual.metadata->>'stage', 'novos') NOT IN ('novos', 'atendimento', 'negociacao') THEN
    RETURN;
  END IF;

  SELECT * INTO destino FROM public.config_options
   WHERE empresa_id = l.empresa_id AND kind = 'crm_status' AND active
     AND metadata->>'stage' = 'orcamento'
   ORDER BY display_order, name LIMIT 1;
  IF destino.id IS NULL OR destino.id = l.status_id THEN RETURN; END IF;

  UPDATE public.crm_leads
     SET status_id = destino.id, last_interaction_at = now()
   WHERE id = l.id;
  INSERT INTO public.crm_status_history (empresa_id, crm_lead_id, previous_status_id, new_status_id,
    previous_status_name, new_status_name, changed_by, change_source, notes)
  VALUES (l.empresa_id, l.id, l.status_id, destino.id, atual.name, destino.name, auth.uid(),
    'Orçamento', coalesce(_nota, 'Orçamento enviado ao cliente.'));
END $$;
REVOKE ALL ON FUNCTION private.lead_orcamento_enviado(uuid, text) FROM PUBLIC, anon, authenticated;

-- Orçamento desligado do lead (ou excluído): se o lead foi para "Orçamento enviado" por causa dele
-- e não tem outro orçamento enviado, volta ao status anterior (com histórico).
CREATE OR REPLACE FUNCTION private.lead_desfazer_orcamento_enviado(_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.crm_leads;
  h public.crm_status_history;
BEGIN
  IF _lead_id IS NULL THEN RETURN; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = _lead_id FOR UPDATE;
  IF l.id IS NULL OR NOT l.is_open OR l.linked_work_order_id IS NOT NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.quotes q WHERE q.crm_lead_id = l.id
              AND q.status IN ('enviado', 'aprovado', 'recusado', 'convertido')) THEN
    RETURN;
  END IF;
  SELECT * INTO h FROM public.crm_status_history
   WHERE crm_lead_id = l.id ORDER BY changed_at DESC, id DESC LIMIT 1;
  IF h.id IS NULL OR h.change_source IS DISTINCT FROM 'Orçamento'
     OR h.new_status_id IS DISTINCT FROM l.status_id THEN
    RETURN;
  END IF;
  UPDATE public.crm_leads SET status_id = h.previous_status_id WHERE id = l.id;
  INSERT INTO public.crm_status_history (empresa_id, crm_lead_id, previous_status_id, new_status_id,
    previous_status_name, new_status_name, changed_by, change_source, notes)
  VALUES (l.empresa_id, l.id, l.status_id, h.previous_status_id, h.new_status_name,
    h.previous_status_name, auth.uid(), 'Orçamento', 'Orçamento desligado deste lead.');
END $$;
REVOKE ALL ON FUNCTION private.lead_desfazer_orcamento_enviado(uuid) FROM PUBLIC, anon, authenticated;

-- Mesmo gatilho de antes (marcos e conversão em OS), mais o status do lead ao virar "enviado".
CREATE OR REPLACE FUNCTION private.quotes_marcos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.atualizar_marcos_lead(OLD.crm_lead_id);
    PERFORM private.lead_desfazer_orcamento_enviado(OLD.crm_lead_id);
    RETURN NULL;
  END IF;
  IF NEW.crm_lead_id IS NOT NULL AND NEW.generated_work_order_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM private.converter_lead_em_os(NEW.crm_lead_id, NEW.generated_work_order_id);
    ELSIF OLD.generated_work_order_id IS DISTINCT FROM NEW.generated_work_order_id
       OR OLD.crm_lead_id IS DISTINCT FROM NEW.crm_lead_id THEN
      PERFORM private.converter_lead_em_os(NEW.crm_lead_id, NEW.generated_work_order_id);
    END IF;
  END IF;
  PERFORM private.atualizar_marcos_lead(NEW.crm_lead_id);
  IF NEW.status = 'enviado' AND NEW.crm_lead_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status
          OR OLD.crm_lead_id IS DISTINCT FROM NEW.crm_lead_id) THEN
    PERFORM private.lead_orcamento_enviado(NEW.crm_lead_id);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.crm_lead_id IS DISTINCT FROM NEW.crm_lead_id THEN
      PERFORM private.atualizar_marcos_lead(OLD.crm_lead_id);
      PERFORM private.lead_desfazer_orcamento_enviado(OLD.crm_lead_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;
