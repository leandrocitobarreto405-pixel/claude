CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER FUNCTION public.convidar_usuario(text, public.papel_empresa) SET SCHEMA private;
ALTER FUNCTION public.empresas_do_usuario(uuid) SET SCHEMA private;
ALTER FUNCTION public.ensure_my_access() SET SCHEMA private;
ALTER FUNCTION public.has_role(uuid, public.app_role) SET SCHEMA private;
ALTER FUNCTION public.is_staff(uuid) SET SCHEMA private;
ALTER FUNCTION public.meu_papel() SET SCHEMA private;
ALTER FUNCTION public.minha_empresa() SET SCHEMA private;
ALTER FUNCTION public.registrar_consumo_produto(uuid, uuid, uuid, numeric) SET SCHEMA private;
ALTER FUNCTION public.registrar_empresa(text, text, text) SET SCHEMA private;
ALTER FUNCTION public.tem_papel(public.papel_empresa) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.convidar_usuario(text, public.papel_empresa) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.empresas_do_usuario(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.ensure_my_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.meu_papel() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.minha_empresa() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.registrar_consumo_produto(uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.registrar_empresa(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.tem_papel(public.papel_empresa) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.convidar_usuario(text, public.papel_empresa) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.empresas_do_usuario(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.ensure_my_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.meu_papel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.minha_empresa() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.registrar_consumo_produto(uuid, uuid, uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.registrar_empresa(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.tem_papel(public.papel_empresa) TO authenticated, service_role;

CREATE FUNCTION public.convidar_usuario(_email text, _papel public.papel_empresa)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public, private
AS $$ SELECT private.convidar_usuario(_email, _papel) $$;
CREATE FUNCTION public.empresas_do_usuario(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private
AS $$ SELECT * FROM private.empresas_do_usuario(_user_id) $$;
CREATE FUNCTION public.ensure_my_access()
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public, private
AS $$ SELECT private.ensure_my_access() $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private
AS $$ SELECT private.has_role(_user_id, _role) $$;
CREATE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private
AS $$ SELECT private.is_staff(_user_id) $$;
CREATE FUNCTION public.meu_papel()
RETURNS public.papel_empresa LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private
AS $$ SELECT private.meu_papel() $$;
CREATE FUNCTION public.minha_empresa()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private
AS $$ SELECT private.minha_empresa() $$;
CREATE FUNCTION public.registrar_consumo_produto(_work_order_id uuid, _visit_id uuid, _produto_id uuid, _quantidade_ml numeric)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public, private
AS $$ SELECT private.registrar_consumo_produto(_work_order_id, _visit_id, _produto_id, _quantidade_ml) $$;
CREATE FUNCTION public.registrar_empresa(_nome text, _cnpj text DEFAULT NULL, _telefone text DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public, private
AS $$ SELECT private.registrar_empresa(_nome, _cnpj, _telefone) $$;
CREATE FUNCTION public.tem_papel(_papel public.papel_empresa)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private
AS $$ SELECT private.tem_papel(_papel) $$;

REVOKE ALL ON FUNCTION public.convidar_usuario(text, public.papel_empresa) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.empresas_do_usuario(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_my_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meu_papel() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.minha_empresa() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_consumo_produto(uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_empresa(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tem_papel(public.papel_empresa) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.convidar_usuario(text, public.papel_empresa) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.empresas_do_usuario(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_my_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meu_papel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.minha_empresa() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_consumo_produto(uuid, uuid, uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_empresa(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tem_papel(public.papel_empresa) TO authenticated, service_role;

DROP POLICY IF EXISTS crm_source_integrations_tenant_all ON public.crm_source_integrations;
CREATE POLICY crm_source_integrations_tenant_select ON public.crm_source_integrations FOR SELECT TO authenticated USING (empresa_id IN (SELECT private.empresas_do_usuario(auth.uid())));
CREATE POLICY crm_source_integrations_tenant_insert ON public.crm_source_integrations FOR INSERT TO authenticated WITH CHECK (empresa_id IN (SELECT private.empresas_do_usuario(auth.uid())));
CREATE POLICY crm_source_integrations_tenant_update ON public.crm_source_integrations FOR UPDATE TO authenticated USING (empresa_id IN (SELECT private.empresas_do_usuario(auth.uid()))) WITH CHECK (empresa_id IN (SELECT private.empresas_do_usuario(auth.uid())));
CREATE POLICY crm_source_integrations_tenant_delete ON public.crm_source_integrations FOR DELETE TO authenticated USING (empresa_id IN (SELECT private.empresas_do_usuario(auth.uid())));

DROP POLICY IF EXISTS crm_webhook_events_tenant_all ON public.crm_webhook_events;
CREATE POLICY crm_webhook_events_tenant_select ON public.crm_webhook_events FOR SELECT TO authenticated USING (empresa_id IN (SELECT private.empresas_do_usuario(auth.uid())));
CREATE POLICY crm_webhook_events_tenant_insert ON public.crm_webhook_events FOR INSERT TO authenticated WITH CHECK (empresa_id IN (SELECT private.empresas_do_usuario(auth.uid())));
CREATE POLICY crm_webhook_events_tenant_update ON public.crm_webhook_events FOR UPDATE TO authenticated USING (empresa_id IN (SELECT private.empresas_do_usuario(auth.uid()))) WITH CHECK (empresa_id IN (SELECT private.empresas_do_usuario(auth.uid())));
CREATE POLICY crm_webhook_events_tenant_delete ON public.crm_webhook_events FOR DELETE TO authenticated USING (empresa_id IN (SELECT private.empresas_do_usuario(auth.uid())));