-- Desempenho do RLS (aviso auth_rls_initplan do Supabase): auth.uid() dentro de
-- (SELECT ...) é avaliado uma vez por consulta, não uma vez por linha.
-- Mesma regra de acesso; só muda a forma de avaliação.

DROP POLICY IF EXISTS plataforma_usuarios_select ON public.plataforma_usuarios;
CREATE POLICY plataforma_usuarios_select ON public.plataforma_usuarios FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT private.is_nexa_admin()));

DROP POLICY IF EXISTS profiles_insert ON public.users_profiles;
CREATE POLICY profiles_insert ON public.users_profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS profiles_read ON public.users_profiles;
CREATE POLICY profiles_read ON public.users_profiles FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR (SELECT private.is_nexa_admin())
    OR id IN (SELECT user_id FROM public.usuarios_empresa WHERE empresa_id = (SELECT private.empresa_ativa()))
  );

DROP POLICY IF EXISTS profiles_update ON public.users_profiles;
CREATE POLICY profiles_update ON public.users_profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT private.is_nexa_admin()))
  WITH CHECK (id = (SELECT auth.uid()) OR (SELECT private.is_nexa_admin()));

DROP POLICY IF EXISTS empresas_select ON public.empresas;
CREATE POLICY empresas_select ON public.empresas FOR SELECT TO authenticated
  USING (id IN (SELECT private.empresas_do_usuario((SELECT auth.uid()))));

DROP POLICY IF EXISTS usuarios_empresa_select ON public.usuarios_empresa;
CREATE POLICY usuarios_empresa_select ON public.usuarios_empresa FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR empresa_id = (SELECT private.empresa_ativa())
    OR (SELECT private.is_nexa_admin())
  );

-- Papel legado (user_roles): mantido, mesma regra.
DROP POLICY IF EXISTS roles_read ON public.user_roles;
CREATE POLICY roles_read ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.has_role((SELECT auth.uid()), 'admin'));
DROP POLICY IF EXISTS roles_admin_insert ON public.user_roles;
CREATE POLICY roles_admin_insert ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));
DROP POLICY IF EXISTS roles_admin_update ON public.user_roles;
CREATE POLICY roles_admin_update ON public.user_roles FOR UPDATE TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));
DROP POLICY IF EXISTS roles_admin_delete ON public.user_roles;
CREATE POLICY roles_admin_delete ON public.user_roles FOR DELETE TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'));
