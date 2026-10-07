-- Usuários e Equipe num passo só (todas as empresas).
-- 1. Vendedora ganha e-mail; técnico ganha o login (user_id) e a foto (caminho na pasta "equipe-fotos").
--    Um login fica ligado a no máximo uma vendedora e um técnico por empresa.
-- 2. Ao entrar na empresa como atendente/técnico (convite aceito, convite de quem já tem conta,
--    cadastro) ou ao mudar o papel para atendente/técnico: liga a vendedora/técnico que já existe
--    (pelo login, depois pelo e-mail, depois pelo mesmo nome) ou cria um. Ao sair do papel, o
--    cadastro ligado é desativado (nada é apagado).
-- 3. Pasta privada "equipe-fotos" (pasta = id da empresa): quem é da empresa vê; só o admin troca.
-- O user_id do técnico não tem chave estrangeira (como o de vendedora tem) para este arquivo poder
-- ir direto, sem o SQL Editor; o vínculo é conferido pela função abaixo.

ALTER TABLE public.salespeople ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.technicians
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS foto_path text;

CREATE UNIQUE INDEX IF NOT EXISTS salespeople_um_por_usuario
  ON public.salespeople (empresa_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS technicians_um_por_usuario
  ON public.technicians (empresa_id, user_id) WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.equipe_vincular_usuario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uemail text;
  unome text;
  alvo uuid;
BEGIN
  SELECT lower(u.email), coalesce(nullif(btrim(p.full_name), ''), split_part(u.email, '@', 1))
    INTO uemail, unome
    FROM auth.users u LEFT JOIN public.users_profiles p ON p.id = u.id
   WHERE u.id = NEW.user_id;

  -- Saiu de atendente/técnico: desativa o cadastro ligado (não apaga).
  IF TG_OP = 'UPDATE' AND OLD.papel IS DISTINCT FROM NEW.papel THEN
    IF OLD.papel = 'atendente' THEN
      UPDATE public.salespeople SET active = false
       WHERE empresa_id = NEW.empresa_id AND user_id = NEW.user_id;
    ELSIF OLD.papel = 'tecnico' THEN
      UPDATE public.technicians SET active = false
       WHERE empresa_id = NEW.empresa_id AND user_id = NEW.user_id;
    END IF;
  END IF;

  IF NEW.papel = 'atendente' THEN
    SELECT id INTO alvo FROM public.salespeople
     WHERE empresa_id = NEW.empresa_id AND user_id = NEW.user_id;
    IF alvo IS NULL AND uemail IS NOT NULL THEN
      SELECT id INTO alvo FROM public.salespeople
       WHERE empresa_id = NEW.empresa_id AND user_id IS NULL AND lower(email) = uemail
       ORDER BY created_at LIMIT 1;
    END IF;
    IF alvo IS NULL THEN
      SELECT id INTO alvo FROM public.salespeople
       WHERE empresa_id = NEW.empresa_id AND user_id IS NULL AND NOT eh_ia
         AND lower(btrim(name)) = lower(btrim(unome))
       ORDER BY created_at LIMIT 1;
    END IF;
    IF alvo IS NOT NULL THEN
      UPDATE public.salespeople
         SET user_id = NEW.user_id, email = coalesce(email, uemail), active = true
       WHERE id = alvo;
    ELSE
      INSERT INTO public.salespeople (empresa_id, name, email, user_id, display_order)
      VALUES (NEW.empresa_id, unome, uemail, NEW.user_id,
              coalesce((SELECT max(display_order) + 1 FROM public.salespeople
                         WHERE empresa_id = NEW.empresa_id), 1));
    END IF;
  ELSIF NEW.papel = 'tecnico' THEN
    SELECT id INTO alvo FROM public.technicians
     WHERE empresa_id = NEW.empresa_id AND user_id = NEW.user_id;
    IF alvo IS NULL AND uemail IS NOT NULL THEN
      SELECT id INTO alvo FROM public.technicians
       WHERE empresa_id = NEW.empresa_id AND user_id IS NULL AND lower(email) = uemail
       ORDER BY created_at LIMIT 1;
    END IF;
    IF alvo IS NULL THEN
      SELECT id INTO alvo FROM public.technicians
       WHERE empresa_id = NEW.empresa_id AND user_id IS NULL
         AND lower(btrim(name)) = lower(btrim(unome))
       ORDER BY created_at LIMIT 1;
    END IF;
    IF alvo IS NOT NULL THEN
      UPDATE public.technicians
         SET user_id = NEW.user_id, email = coalesce(email, uemail), active = true
       WHERE id = alvo;
    ELSE
      INSERT INTO public.technicians (empresa_id, name, email, user_id, display_order)
      VALUES (NEW.empresa_id, unome, uemail, NEW.user_id,
              coalesce((SELECT max(display_order) + 1 FROM public.technicians
                         WHERE empresa_id = NEW.empresa_id), 1));
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.equipe_vincular_usuario() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_usuarios_empresa_equipe
  AFTER INSERT OR UPDATE OF papel ON public.usuarios_empresa
  FOR EACH ROW EXECUTE FUNCTION private.equipe_vincular_usuario();

-- Fotos da equipe (técnicos). Pasta = id da empresa.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('equipe-fotos', 'equipe-fotos', false, 5242880,
            ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO NOTHING;

    EXECUTE $p$CREATE POLICY equipe_fotos_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'equipe-fotos'
             AND (storage.foldername(name))[1] IN (SELECT private.empresas_do_usuario((SELECT auth.uid()))::text))$p$;
    EXECUTE $p$CREATE POLICY equipe_fotos_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'equipe-fotos'
             AND (storage.foldername(name))[1] = (SELECT private.empresa_ativa())::text
             AND (SELECT private.tem_papel('admin')))$p$;
    EXECUTE $p$CREATE POLICY equipe_fotos_update ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'equipe-fotos'
             AND (storage.foldername(name))[1] = (SELECT private.empresa_ativa())::text
             AND (SELECT private.tem_papel('admin')))$p$;
  END IF;
END $$;
