-- staff helper
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','operator'));
$$;

-- seed roles for existing users so access is preserved
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM public.users_profiles
ON CONFLICT (user_id, role) DO NOTHING;

-- business tables: staff read/write, admin-only delete
DROP POLICY IF EXISTS settings_all ON public.app_settings;
DROP POLICY IF EXISTS cfg_all ON public.config_options;
DROP POLICY IF EXISTS cust_all ON public.customers;
DROP POLICY IF EXISTS route_all ON public.daily_routes;
DROP POLICY IF EXISTS exp_all ON public.expenses;
DROP POLICY IF EXISTS inv_all ON public.invoice_tasks;
DROP POLICY IF EXISTS goal_all ON public.monthly_goals;
DROP POLICY IF EXISTS rates_all ON public.payment_rates;
DROP POLICY IF EXISTS pay_all ON public.payments;
DROP POLICY IF EXISTS rec_all ON public.recurring_expenses;
DROP POLICY IF EXISTS sp_all ON public.salespeople;
DROP POLICY IF EXISTS tec_all ON public.technicians;
DROP POLICY IF EXISTS visits_all ON public.visits;
DROP POLICY IF EXISTS wo_all ON public.work_orders;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_settings','config_options','customers','daily_routes','expenses','invoice_tasks','monthly_goals','payment_rates','payments','recurring_expenses','salespeople','technicians','visits','work_orders']
  LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff(auth.uid()))', t||'_staff_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()))', t||'_staff_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))', t||'_staff_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_role(auth.uid(), ''admin''))', t||'_admin_delete', t);
  END LOOP;
END $$;

-- users_profiles: own row (or admin)
DROP POLICY IF EXISTS profiles_read ON public.users_profiles;
DROP POLICY IF EXISTS profiles_update ON public.users_profiles;
DROP POLICY IF EXISTS profiles_insert ON public.users_profiles;

CREATE POLICY profiles_read ON public.users_profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY profiles_insert ON public.users_profiles FOR INSERT TO authenticated
WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update ON public.users_profiles FOR UPDATE TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- user_roles: own rows readable, admin manages
DROP POLICY IF EXISTS roles_read ON public.user_roles;
CREATE POLICY roles_read ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY roles_admin_insert ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY roles_admin_update ON public.user_roles FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY roles_admin_delete ON public.user_roles FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

-- lock down internal definer functions
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;