-- Logo da empresa para os documentos em PDF (Configurações › Empresa). Bucket privado, uma pasta
-- por empresa (nome da pasta = id da empresa): quem é da empresa vê, só o admin envia/troca.
-- Não cria nem altera tabelas.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('empresa-logos', 'empresa-logos', false, 2097152, ARRAY['image/png', 'image/jpeg'])
    ON CONFLICT (id) DO NOTHING;

    EXECUTE $p$CREATE POLICY empresa_logos_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'empresa-logos'
             AND (storage.foldername(name))[1] IN (SELECT private.empresas_do_usuario((SELECT auth.uid()))::text))$p$;
    EXECUTE $p$CREATE POLICY empresa_logos_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'empresa-logos'
             AND (storage.foldername(name))[1] = (SELECT private.empresa_ativa())::text
             AND (SELECT private.tem_papel('admin')))$p$;
    EXECUTE $p$CREATE POLICY empresa_logos_update ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'empresa-logos'
             AND (storage.foldername(name))[1] = (SELECT private.empresa_ativa())::text
             AND (SELECT private.tem_papel('admin')))$p$;
  END IF;
END $$;
