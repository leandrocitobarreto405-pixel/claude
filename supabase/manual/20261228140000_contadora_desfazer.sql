-- Desfaz 20261228140000_contadora (papel Contadora). Tira o acesso das contadoras e as funções
-- de leitura; volta o aceite de convites ao de antes. As colunas novas de invoice_tasks e
-- expenses (motivo do cancelamento, XML, comprovante e situação do Drive) ficam: não apagam nada.
-- Os arquivos já anexados continuam no bucket notas-fiscais.
DROP FUNCTION IF EXISTS public.contadora_os_realizadas(uuid, date, date);
DROP FUNCTION IF EXISTS public.contadora_notas(uuid, text, date, date);
DROP FUNCTION IF EXISTS public.contadora_despesas(uuid, date, date);
DROP FUNCTION IF EXISTS public.contadora_minhas_empresas();
DROP FUNCTION IF EXISTS public.contadora_pode(uuid);
DROP FUNCTION IF EXISTS private.ve_contabil(uuid);
DROP FUNCTION IF EXISTS private.sou_contadora(uuid);

CREATE OR REPLACE FUNCTION private.ensure_my_access()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  FOR convite IN
    SELECT * FROM public.convites_empresa
     WHERE lower(email) = lower(uemail) AND aceito_em IS NULL ORDER BY created_at
  LOOP
    INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
    VALUES (uid, convite.empresa_id, convite.papel)
    ON CONFLICT (user_id, empresa_id) DO NOTHING;
    UPDATE public.convites_empresa SET aceito_em = now() WHERE id = convite.id;
  END LOOP;
END $function$;

-- As tabelas de vínculo e convites só são apagadas com OK explícito (guardam quem tinha acesso):
-- DROP TABLE public.convites_contadora; DROP TABLE public.contadoras_empresa;
