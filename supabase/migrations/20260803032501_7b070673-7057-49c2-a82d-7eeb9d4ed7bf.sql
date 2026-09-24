CREATE OR REPLACE FUNCTION public.ensure_my_access()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  uname text;
  has_any boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT email, COALESCE(raw_user_meta_data->>'full_name', split_part(email,'@',1))
  INTO uemail, uname
  FROM auth.users WHERE id = uid;

  INSERT INTO public.users_profiles (id, full_name, email)
  VALUES (uid, COALESCE(uname,''), uemail)
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid) THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles) INTO has_any;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (uid, CASE WHEN has_any THEN 'operator'::app_role ELSE 'admin'::app_role END)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_access() TO authenticated;