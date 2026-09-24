-- ============ CATÁLOGOS EDITÁVEIS (reuso de config_options) ============
INSERT INTO public.config_options (kind, name, active, display_order, metadata) VALUES
  ('crm_status','Novo contato',true,1,'{"color":"navy","stage":"novos"}'),
  ('crm_status','Aguardando atendimento',true,2,'{"color":"warning","stage":"novos"}'),
  ('crm_status','Em atendimento',true,3,'{"color":"teal","stage":"atendimento"}'),
  ('crm_status','Em negociação',true,4,'{"color":"teal","stage":"negociacao"}'),
  ('crm_status','Orçamento enviado',true,5,'{"color":"warning","stage":"orcamento"}'),
  ('crm_status','Aguardando resposta',true,6,'{"color":"warning","stage":"aguardando"}'),
  ('crm_status','Não respondeu / Repescar',true,7,'{"color":"danger","stage":"repescar"}'),
  ('crm_status','Agendado',true,8,'{"color":"success","stage":"agendados","closed":true}'),
  ('crm_status','Desistiu',true,9,'{"color":"danger","stage":"desistiram","closed":true,"lost":true}'),
  ('crm_status','Pós-venda',true,10,'{"color":"success","stage":"agendados","closed":true}'),
  ('crm_followup_result','Aguardando resposta',true,1,'{}'),
  ('crm_followup_result','Pediu mais tempo',true,2,'{}'),
  ('crm_followup_result','Vai conversar com outra pessoa',true,3,'{}'),
  ('crm_followup_result','Aguardando fotos',true,4,'{}'),
  ('crm_followup_result','Aguardando chegada do estofado',true,5,'{}'),
  ('crm_followup_result','Achou o valor alto',true,6,'{}'),
  ('crm_followup_result','Encontrou preço menor',true,7,'{}'),
  ('crm_followup_result','Quer agendar',true,8,'{}'),
  ('crm_followup_result','Sem interesse',true,9,'{}'),
  ('crm_followup_result','Outro',true,10,'{}'),
  ('crm_loss_reason','Preço',true,1,'{}'),
  ('crm_loss_reason','Concorrente mais barato',true,2,'{}'),
  ('crm_loss_reason','Não está na região atendida',true,3,'{}'),
  ('crm_loss_reason','Serviço não compensou',true,4,'{}'),
  ('crm_loss_reason','Recebeu o serviço da loja',true,5,'{}'),
  ('crm_loss_reason','Comprará outro estofado',true,6,'{}'),
  ('crm_loss_reason','Sem retorno',true,7,'{}'),
  ('crm_loss_reason','Cancelou',true,8,'{}'),
  ('crm_loss_reason','Não possui previsão',true,9,'{}'),
  ('crm_loss_reason','Outro',true,10,'{}'),
  ('crm_service_interest','Higienização',true,1,'{}'),
  ('crm_service_interest','Impermeabilização',true,2,'{}'),
  ('crm_service_interest','Higienização e impermeabilização',true,3,'{}'),
  ('crm_service_interest','Não identificado',true,4,'{}');

-- ============ CAMPANHAS ============
CREATE TABLE public.crm_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL DEFAULT 'Meta Ads',
  campaign_name text NOT NULL,
  campaign_external_id text,
  ad_set_name text,
  ad_set_external_id text,
  ad_name text,
  ad_external_id text,
  advertised_service text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_campaigns_ad_external_id_key ON public.crm_campaigns (ad_external_id) WHERE ad_external_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_campaigns TO authenticated;
GRANT ALL ON public.crm_campaigns TO service_role;
ALTER TABLE public.crm_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_campaigns_staff_select" ON public.crm_campaigns FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "crm_campaigns_staff_insert" ON public.crm_campaigns FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "crm_campaigns_staff_update" ON public.crm_campaigns FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "crm_campaigns_staff_delete" ON public.crm_campaigns FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_crm_campaigns_upd BEFORE UPDATE ON public.crm_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.campaign_investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  reference_date date NOT NULL,
  period_end_date date,
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_investments TO authenticated;
GRANT ALL ON public.campaign_investments TO service_role;
ALTER TABLE public.campaign_investments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_investments_staff_select" ON public.campaign_investments FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "campaign_investments_staff_insert" ON public.campaign_investments FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "campaign_investments_staff_update" ON public.campaign_investments FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "campaign_investments_staff_delete" ON public.campaign_investments FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));
CREATE TRIGGER trg_campaign_investments_upd BEFORE UPDATE ON public.campaign_investments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ CONTATOS DE WHATSAPP ============
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id text,
  normalized_phone text NOT NULL,
  display_phone text,
  profile_name text,
  current_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  first_contact_at timestamptz NOT NULL DEFAULT now(),
  last_contact_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  total_inbound_messages integer NOT NULL DEFAULT 0,
  total_outbound_messages integer NOT NULL DEFAULT 0,
  is_existing_customer boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_contacts_normalized_phone_key ON public.whatsapp_contacts (normalized_phone);
CREATE UNIQUE INDEX whatsapp_contacts_wa_id_key ON public.whatsapp_contacts (wa_id) WHERE wa_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_contacts TO authenticated;
GRANT ALL ON public.whatsapp_contacts TO service_role;
ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_contacts_staff_select" ON public.whatsapp_contacts FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp_contacts_staff_insert" ON public.whatsapp_contacts FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp_contacts_staff_update" ON public.whatsapp_contacts FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp_contacts_admin_delete" ON public.whatsapp_contacts FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_whatsapp_contacts_upd BEFORE UPDATE ON public.whatsapp_contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ LOTES DE IMPORTAÇÃO ============
CREATE TABLE public.crm_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text,
  mode text NOT NULL DEFAULT 'somente_novos',
  total_rows integer NOT NULL DEFAULT 0,
  created_leads integer NOT NULL DEFAULT 0,
  updated_leads integer NOT NULL DEFAULT 0,
  skipped_rows integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_import_batches TO authenticated;
GRANT ALL ON public.crm_import_batches TO service_role;
ALTER TABLE public.crm_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_import_batches_staff_select" ON public.crm_import_batches FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "crm_import_batches_staff_insert" ON public.crm_import_batches FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "crm_import_batches_staff_update" ON public.crm_import_batches FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ============ LEADS ============
CREATE TABLE public.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_contact_id uuid REFERENCES public.whatsapp_contacts(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  first_contact_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  lead_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  normalized_phone text,
  upholstery_description text,
  service_interest text,
  temperature text NOT NULL DEFAULT 'FRIO',
  temperature_score integer,
  temperature_confirmed boolean NOT NULL DEFAULT false,
  status_id uuid REFERENCES public.config_options(id),
  summary text,
  summary_source text NOT NULL DEFAULT 'Manual',
  last_follow_up_at timestamptz,
  follow_up_result text,
  next_follow_up_at timestamptz,
  salesperson_id uuid REFERENCES public.salespeople(id) ON DELETE SET NULL,
  sales_origin_id uuid REFERENCES public.config_options(id),
  campaign_id uuid REFERENCES public.crm_campaigns(id) ON DELETE SET NULL,
  ad_id text,
  source_type text,
  referral_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  loss_reason_id uuid REFERENCES public.config_options(id),
  linked_work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  is_open boolean NOT NULL DEFAULT true,
  last_interaction_at timestamptz,
  notes text,
  import_batch_id uuid REFERENCES public.crm_import_batches(id) ON DELETE SET NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_leads_contact_idx ON public.crm_leads (whatsapp_contact_id);
CREATE INDEX crm_leads_open_idx ON public.crm_leads (whatsapp_contact_id) WHERE is_open;
CREATE INDEX crm_leads_phone_idx ON public.crm_leads (normalized_phone);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_leads TO authenticated;
GRANT ALL ON public.crm_leads TO service_role;
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_leads_staff_select" ON public.crm_leads FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "crm_leads_staff_insert" ON public.crm_leads FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "crm_leads_staff_update" ON public.crm_leads FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "crm_leads_admin_delete" ON public.crm_leads FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_crm_leads_upd BEFORE UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ MENSAGENS ============
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_contact_id uuid NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  whatsapp_message_id text,
  direction text NOT NULL DEFAULT 'Recebida',
  message_type text NOT NULL DEFAULT 'Texto',
  text_content text,
  media_id text,
  message_timestamp timestamptz NOT NULL DEFAULT now(),
  reply_to_message_id text,
  delivery_status text,
  referral_source_id text,
  referral_source_url text,
  referral_headline text,
  referral_body text,
  raw_event_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_messages_wamid_key ON public.whatsapp_messages (whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
CREATE INDEX whatsapp_messages_contact_idx ON public.whatsapp_messages (whatsapp_contact_id, message_timestamp DESC);
CREATE INDEX whatsapp_messages_lead_idx ON public.whatsapp_messages (crm_lead_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_messages_staff_select" ON public.whatsapp_messages FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp_messages_staff_insert" ON public.whatsapp_messages FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp_messages_staff_update" ON public.whatsapp_messages FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp_messages_admin_delete" ON public.whatsapp_messages FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ============ HISTÓRICO DE STATUS ============
CREATE TABLE public.crm_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  previous_status_id uuid,
  new_status_id uuid,
  previous_status_name text,
  new_status_name text,
  changed_by uuid,
  change_source text NOT NULL DEFAULT 'Manual',
  notes text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_status_history_lead_idx ON public.crm_status_history (crm_lead_id, changed_at DESC);
GRANT SELECT, INSERT ON public.crm_status_history TO authenticated;
GRANT ALL ON public.crm_status_history TO service_role;
ALTER TABLE public.crm_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_status_history_staff_select" ON public.crm_status_history FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "crm_status_history_staff_insert" ON public.crm_status_history FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

-- ============ REPESCAGENS ============
CREATE TABLE public.crm_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  result text,
  notes text,
  assigned_to uuid,
  status text NOT NULL DEFAULT 'Pendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_followups_lead_idx ON public.crm_followups (crm_lead_id);
CREATE INDEX crm_followups_pending_idx ON public.crm_followups (scheduled_at) WHERE status = 'Pendente';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_followups TO authenticated;
GRANT ALL ON public.crm_followups TO service_role;
ALTER TABLE public.crm_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_followups_staff_select" ON public.crm_followups FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "crm_followups_staff_insert" ON public.crm_followups FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "crm_followups_staff_update" ON public.crm_followups FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "crm_followups_staff_delete" ON public.crm_followups FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));
CREATE TRIGGER trg_crm_followups_upd BEFORE UPDATE ON public.crm_followups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ EVENTOS DO WEBHOOK ============
CREATE TABLE public.crm_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_reference text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'Recebido',
  contact_id uuid,
  crm_lead_id uuid,
  contact_created boolean NOT NULL DEFAULT false,
  lead_created boolean NOT NULL DEFAULT false,
  messages_stored integer NOT NULL DEFAULT 0,
  duplicated_messages integer NOT NULL DEFAULT 0,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX crm_webhook_events_received_idx ON public.crm_webhook_events (received_at DESC);
GRANT SELECT, UPDATE ON public.crm_webhook_events TO authenticated;
GRANT ALL ON public.crm_webhook_events TO service_role;
ALTER TABLE public.crm_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_webhook_events_staff_select" ON public.crm_webhook_events FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "crm_webhook_events_staff_update" ON public.crm_webhook_events FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));