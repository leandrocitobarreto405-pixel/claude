CREATE TYPE public.crm_source_type AS ENUM ('meta_lead_ads', 'google_ads', 'custom_form');

CREATE TABLE public.crm_source_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  source_type public.crm_source_type NOT NULL,
  webhook_token text NOT NULL UNIQUE,
  secret text,
  field_mapping jsonb NOT NULL DEFAULT '{}',
  default_campaign_id uuid REFERENCES public.crm_campaigns(id) ON DELETE SET NULL,
  default_salesperson_id uuid REFERENCES public.salespeople(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_source_integrations TO authenticated;
GRANT ALL ON public.crm_source_integrations TO service_role;

ALTER TABLE public.crm_source_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff pode gerenciar integrações de leads"
  ON public.crm_source_integrations
  FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_crm_source_integrations_upd
BEFORE UPDATE ON public.crm_source_integrations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();