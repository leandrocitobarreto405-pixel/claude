-- 1. Empresas e vínculo de usuários
CREATE TABLE IF NOT EXISTS public.empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cnpj text,
  telefone text,
  ativo boolean NOT NULL DEFAULT true,
  plano text NOT NULL DEFAULT 'basico',
  controle_insumos_ativo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE public.papel_empresa AS ENUM ('admin','atendente','tecnico');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.usuarios_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  papel public.papel_empresa NOT NULL DEFAULT 'atendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, empresa_id)
);

CREATE TABLE IF NOT EXISTS public.convites_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  email text NOT NULL,
  papel public.papel_empresa NOT NULL DEFAULT 'atendente',
  aceito_em timestamptz,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, email)
);

GRANT SELECT, INSERT, UPDATE ON public.empresas TO authenticated;
GRANT ALL ON public.empresas TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usuarios_empresa TO authenticated;
GRANT ALL ON public.usuarios_empresa TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.convites_empresa TO authenticated;
GRANT ALL ON public.convites_empresa TO service_role;

-- 2. Empresa inicial: Turbine Clean (dados existentes)
INSERT INTO public.empresas (id, nome, cnpj, plano)
VALUES ('11111111-1111-1111-1111-111111111111', 'Turbine Clean', '49.665.244/0001-82', 'pro')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT ur.user_id, '11111111-1111-1111-1111-111111111111',
       CASE WHEN ur.role = 'admin' THEN 'admin'::public.papel_empresa ELSE 'atendente'::public.papel_empresa END
FROM public.user_roles ur
ON CONFLICT (user_id, empresa_id) DO NOTHING;

-- 3. Funções auxiliares
CREATE OR REPLACE FUNCTION public.empresas_do_usuario(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT empresa_id FROM public.usuarios_empresa WHERE user_id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.minha_empresa()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT empresa_id FROM public.usuarios_empresa WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.meu_papel()
RETURNS public.papel_empresa
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT papel FROM public.usuarios_empresa WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.tem_papel(_papel public.papel_empresa)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.usuarios_empresa WHERE user_id = auth.uid() AND papel = _papel);
$$;

REVOKE ALL ON FUNCTION public.empresas_do_usuario(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.minha_empresa() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meu_papel() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tem_papel(public.papel_empresa) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empresas_do_usuario(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.minha_empresa() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meu_papel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tem_papel(public.papel_empresa) TO authenticated, service_role;

-- 4. RLS das novas tabelas
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS empresas_select ON public.empresas;
CREATE POLICY empresas_select ON public.empresas FOR SELECT TO authenticated
  USING (id IN (SELECT public.empresas_do_usuario(auth.uid())));
DROP POLICY IF EXISTS empresas_update ON public.empresas;
CREATE POLICY empresas_update ON public.empresas FOR UPDATE TO authenticated
  USING (id IN (SELECT public.empresas_do_usuario(auth.uid())) AND public.tem_papel('admin'))
  WITH CHECK (id IN (SELECT public.empresas_do_usuario(auth.uid())));
DROP POLICY IF EXISTS empresas_insert ON public.empresas;
CREATE POLICY empresas_insert ON public.empresas FOR INSERT TO authenticated WITH CHECK (true);

ALTER TABLE public.usuarios_empresa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usuarios_empresa_select ON public.usuarios_empresa;
CREATE POLICY usuarios_empresa_select ON public.usuarios_empresa FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())));
DROP POLICY IF EXISTS usuarios_empresa_admin_write ON public.usuarios_empresa;
CREATE POLICY usuarios_empresa_admin_write ON public.usuarios_empresa FOR UPDATE TO authenticated
  USING (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())) AND public.tem_papel('admin'))
  WITH CHECK (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())));
DROP POLICY IF EXISTS usuarios_empresa_admin_delete ON public.usuarios_empresa;
CREATE POLICY usuarios_empresa_admin_delete ON public.usuarios_empresa FOR DELETE TO authenticated
  USING (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())) AND public.tem_papel('admin'));

ALTER TABLE public.convites_empresa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS convites_all ON public.convites_empresa;
CREATE POLICY convites_all ON public.convites_empresa FOR ALL TO authenticated
  USING (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())) AND public.tem_papel('admin'))
  WITH CHECK (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())) AND public.tem_papel('admin'));

-- 5. empresa_id em todas as tabelas de negócio + políticas por empresa
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'app_settings','budget_visits','campaign_investments','config_options','crm_campaigns',
    'crm_followups','crm_import_batches','crm_leads','crm_source_integrations','crm_status_history',
    'crm_webhook_events','customers','daily_routes','expense_status_history','expenses',
    'invoice_tasks','job_runs','monthly_goals','os_produtos_utilizados','payment_history',
    'payment_rates','payments','produtos','recurring_expenses','route_cost_allocations',
    'salespeople','service_items','technician_expenses','technicians','visits',
    'whatsapp_contacts','whatsapp_messages','work_order_documents','work_order_history','work_orders'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS empresa_id uuid NOT NULL DEFAULT ''11111111-1111-1111-1111-111111111111'' REFERENCES public.empresas(id)', t);
    EXECUTE format('UPDATE public.%I SET empresa_id = ''11111111-1111-1111-1111-111111111111'' WHERE empresa_id IS NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (empresa_id)', 'idx_' || t || '_empresa', t);

    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid()))) WITH CHECK (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())))',
      t || '_tenant_all', t);
  END LOOP;
END $$;

-- 6. Cadastro: cria a empresa e vincula o usuário como admin; aceita convite se existir
CREATE OR REPLACE FUNCTION public.registrar_empresa(_nome text, _cnpj text DEFAULT NULL, _telefone text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  nova uuid;
  convite public.convites_empresa;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  INSERT INTO public.users_profiles (id, full_name, email)
  VALUES (uid, COALESCE((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = uid), split_part(uemail,'@',1)), uemail)
  ON CONFLICT (id) DO NOTHING;

  -- já vinculado: devolve a empresa atual
  SELECT empresa_id INTO nova FROM public.usuarios_empresa WHERE user_id = uid ORDER BY created_at LIMIT 1;
  IF nova IS NOT NULL THEN RETURN nova; END IF;

  -- convite pendente para este e-mail
  SELECT * INTO convite FROM public.convites_empresa
   WHERE lower(email) = lower(uemail) AND aceito_em IS NULL ORDER BY created_at LIMIT 1;
  IF convite.id IS NOT NULL THEN
    INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
    VALUES (uid, convite.empresa_id, convite.papel)
    ON CONFLICT (user_id, empresa_id) DO NOTHING;
    UPDATE public.convites_empresa SET aceito_em = now() WHERE id = convite.id;
    RETURN convite.empresa_id;
  END IF;

  IF _nome IS NULL OR length(trim(_nome)) < 2 THEN
    RAISE EXCEPTION 'informe o nome da empresa';
  END IF;

  INSERT INTO public.empresas (nome, cnpj, telefone)
  VALUES (trim(_nome), _cnpj, _telefone) RETURNING id INTO nova;

  INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
  VALUES (uid, nova, 'admin');

  RETURN nova;
END $$;

REVOKE ALL ON FUNCTION public.registrar_empresa(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_empresa(text, text, text) TO authenticated, service_role;

-- 7. Convidar usuário por e-mail (somente admin da empresa)
CREATE OR REPLACE FUNCTION public.convidar_usuario(_email text, _papel public.papel_empresa)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp uuid := public.minha_empresa();
  alvo uuid;
  convite_id uuid;
BEGIN
  IF emp IS NULL OR NOT public.tem_papel('admin') THEN
    RAISE EXCEPTION 'apenas administradores podem convidar usuários';
  END IF;

  SELECT id INTO alvo FROM auth.users WHERE lower(email) = lower(trim(_email));

  IF alvo IS NOT NULL THEN
    INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
    VALUES (alvo, emp, _papel)
    ON CONFLICT (user_id, empresa_id) DO UPDATE SET papel = EXCLUDED.papel;
  END IF;

  INSERT INTO public.convites_empresa (empresa_id, email, papel, criado_por, aceito_em)
  VALUES (emp, lower(trim(_email)), _papel, auth.uid(), CASE WHEN alvo IS NULL THEN NULL ELSE now() END)
  ON CONFLICT (empresa_id, email) DO UPDATE SET papel = EXCLUDED.papel
  RETURNING id INTO convite_id;

  RETURN convite_id;
END $$;

REVOKE ALL ON FUNCTION public.convidar_usuario(text, public.papel_empresa) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convidar_usuario(text, public.papel_empresa) TO authenticated, service_role;

-- 8. ensure_my_access continua provisionando perfil e vínculo (convite/empresa existente)
CREATE OR REPLACE FUNCTION public.ensure_my_access()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  uname text;
  convite public.convites_empresa;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT email, COALESCE(raw_user_meta_data->>'full_name', split_part(email,'@',1))
    INTO uemail, uname FROM auth.users WHERE id = uid;

  INSERT INTO public.users_profiles (id, full_name, email)
  VALUES (uid, COALESCE(uname,''), uemail)
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.usuarios_empresa WHERE user_id = uid) THEN
    SELECT * INTO convite FROM public.convites_empresa
     WHERE lower(email) = lower(uemail) AND aceito_em IS NULL ORDER BY created_at LIMIT 1;
    IF convite.id IS NOT NULL THEN
      INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
      VALUES (uid, convite.empresa_id, convite.papel)
      ON CONFLICT (user_id, empresa_id) DO NOTHING;
      UPDATE public.convites_empresa SET aceito_em = now() WHERE id = convite.id;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (uid, CASE WHEN EXISTS (SELECT 1 FROM public.user_roles) THEN 'operator'::app_role ELSE 'admin'::app_role END)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END $$;

CREATE TRIGGER trg_empresas_upd BEFORE UPDATE ON public.empresas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();