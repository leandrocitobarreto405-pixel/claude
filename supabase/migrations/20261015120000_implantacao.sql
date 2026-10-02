-- Configuração da empresa (checklist de implantação), aprovada em 02/10/2026.
-- - empresas.implantacao_liberada_em: a Nexa libera a empresa quando as etapas obrigatórias
--   ficam prontas. Só a Nexa muda esse campo. As empresas que já existem entram liberadas.
-- - implantacao_etapas: o que a empresa marcou à mão ("Revisei", "Não se aplica").
-- - Empresa não liberada: a Alice não liga, os envios a clientes (campanhas, gatilhos e
--   promoção) não ligam e a reserva do disparo não pega nada dela.

-- ================================================================ 1. liberação
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS implantacao_liberada_em timestamptz,
  ADD COLUMN IF NOT EXISTS implantacao_liberada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;
UPDATE public.empresas SET implantacao_liberada_em = now() WHERE implantacao_liberada_em IS NULL;

-- Só a Nexa (ou o servidor) libera ou bloqueia; o admin da empresa não muda o próprio campo.
-- Sem SECURITY DEFINER de propósito: current_user é quem fez o UPDATE (pelo app, "authenticated";
-- dentro de funções do banco como liberar_empresa, o dono delas).
CREATE OR REPLACE FUNCTION private.empresas_proteger_liberacao()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.implantacao_liberada_em IS DISTINCT FROM OLD.implantacao_liberada_em
      OR NEW.implantacao_liberada_por IS DISTINCT FROM OLD.implantacao_liberada_por)
     AND current_user IN ('authenticated', 'anon') AND NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Só a Nexa libera a empresa.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.empresas_proteger_liberacao() FROM PUBLIC, anon;
CREATE TRIGGER trg_empresas_proteger_liberacao BEFORE UPDATE ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION private.empresas_proteger_liberacao();

-- Empresa nova (cadastrada pela Nexa) começa não liberada.
CREATE OR REPLACE FUNCTION private.empresas_nova_nao_liberada()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.implantacao_liberada_em := NULL;
    NEW.implantacao_liberada_por := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.empresas_nova_nao_liberada() FROM PUBLIC, anon;
CREATE TRIGGER trg_empresas_nova_nao_liberada BEFORE INSERT ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION private.empresas_nova_nao_liberada();

CREATE OR REPLACE FUNCTION private.empresa_liberada(_emp uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT e.implantacao_liberada_em IS NOT NULL FROM public.empresas e WHERE e.id = _emp), false);
$$;
REVOKE ALL ON FUNCTION private.empresa_liberada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.empresa_liberada(uuid) TO authenticated, service_role;

-- Liberar (ou voltar a bloquear) — só a Nexa. Bloquear desliga a Alice e os envios a clientes.
CREATE OR REPLACE FUNCTION public.liberar_empresa(_emp uuid, _liberar boolean)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  quando timestamptz;
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Só a Nexa libera a empresa.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.empresas
     SET implantacao_liberada_em = CASE WHEN _liberar THEN coalesce(implantacao_liberada_em, now()) END,
         implantacao_liberada_por = CASE WHEN _liberar THEN coalesce(implantacao_liberada_por, auth.uid()) END
   WHERE id = _emp
  RETURNING implantacao_liberada_em INTO quando;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;
  IF NOT _liberar THEN
    UPDATE public.ia_configuracoes SET ativo = false WHERE empresa_id = _emp AND ativo;
    UPDATE public.mkt_configuracoes
       SET disparo_ligado = false, gatilho_c1_ligado = false, gatilho_c2_ligado = false,
           gatilho_c3_ligado = false
     WHERE empresa_id = _emp
       AND (disparo_ligado OR gatilho_c1_ligado OR gatilho_c2_ligado OR gatilho_c3_ligado);
  END IF;
  RETURN quando;
END $$;
REVOKE ALL ON FUNCTION public.liberar_empresa(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.liberar_empresa(uuid, boolean) TO authenticated, service_role;

-- ================================================================ 2. travas enquanto não liberada
-- Ligar a Alice ou um envio a clientes numa empresa não liberada dá erro (desligar sempre pode).
CREATE OR REPLACE FUNCTION private.implantacao_exigir_liberacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ligando boolean;
BEGIN
  IF TG_TABLE_NAME = 'ia_configuracoes' THEN
    ligando := NEW.ativo AND (TG_OP = 'INSERT' OR NOT OLD.ativo);
  ELSE
    ligando := (NEW.disparo_ligado AND (TG_OP = 'INSERT' OR NOT OLD.disparo_ligado))
            OR (NEW.gatilho_c1_ligado AND (TG_OP = 'INSERT' OR NOT OLD.gatilho_c1_ligado))
            OR (NEW.gatilho_c2_ligado AND (TG_OP = 'INSERT' OR NOT OLD.gatilho_c2_ligado))
            OR (NEW.gatilho_c3_ligado AND (TG_OP = 'INSERT' OR NOT OLD.gatilho_c3_ligado));
  END IF;
  IF ligando AND NOT private.empresa_liberada(NEW.empresa_id) THEN
    RAISE EXCEPTION 'Termine a configuração obrigatória da empresa: a Nexa libera a Alice e os envios depois disso.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.implantacao_exigir_liberacao() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_ia_configuracoes_liberacao BEFORE INSERT OR UPDATE ON public.ia_configuracoes
  FOR EACH ROW EXECUTE FUNCTION private.implantacao_exigir_liberacao();
CREATE TRIGGER trg_mkt_configuracoes_liberacao BEFORE INSERT OR UPDATE ON public.mkt_configuracoes
  FOR EACH ROW EXECUTE FUNCTION private.implantacao_exigir_liberacao();

-- ================================================================ 3. etapas marcadas à mão
CREATE TABLE public.implantacao_etapas (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  etapa text NOT NULL CHECK (etapa ~ '^[a-z_]{2,40}$'),
  -- "pendente" = desmarcada (sem apagar a linha).
  situacao text NOT NULL CHECK (situacao IN ('revisado', 'nao_se_aplica', 'pendente')),
  marcado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  marcado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, etapa)
);
ALTER TABLE public.implantacao_etapas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.implantacao_etapas FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.implantacao_etapas TO authenticated;
GRANT ALL ON public.implantacao_etapas TO service_role;
CREATE POLICY implantacao_etapas_select ON public.implantacao_etapas FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE POLICY implantacao_etapas_insert ON public.implantacao_etapas FOR INSERT TO authenticated
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE POLICY implantacao_etapas_update ON public.implantacao_etapas FOR UPDATE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
