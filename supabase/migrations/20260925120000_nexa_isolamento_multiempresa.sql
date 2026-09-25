-- =====================================================================================
-- Nexa OS — Etapa 2: isolamento multiempresa
--
-- 1. Papéis de plataforma (Nexa) e "empresa ativa" por requisição (cabeçalho x-empresa-id,
--    validado contra os vínculos do usuário).
-- 2. RLS de todas as tabelas de negócio restrita à empresa ativa.
-- 3. empresa_id preenchido pela empresa ativa (fim do DEFAULT fixo da Turbine Clean);
--    gravações com a chave de serviço precisam informar a empresa explicitamente.
-- 4. Gatilhos de referência: um registro nunca aponta para outro de outra empresa.
-- 5. Unicidades por empresa (nº da OS, configurações, telefone, etc.).
-- 6. Papéis verificados na empresa certa; cadastro de empresa só pela Nexa.
-- 7. Configurações da plataforma e contrato de comissão por empresa (editáveis).
-- =====================================================================================

-- ---------------------------------------------------------------- 1. Plataforma Nexa
CREATE TABLE public.plataforma_usuarios (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  papel text NOT NULL CHECK (papel IN ('nexa_admin', 'nexa_atendente')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plataforma_usuarios ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.plataforma_usuarios TO authenticated;
GRANT ALL ON public.plataforma_usuarios TO service_role;

CREATE OR REPLACE FUNCTION private.is_nexa_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.plataforma_usuarios
     WHERE user_id = _user_id AND papel = 'nexa_admin' AND ativo
  );
$$;

CREATE POLICY plataforma_usuarios_select ON public.plataforma_usuarios FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_nexa_admin());

-- Empresas visíveis ao usuário: vínculos diretos; o admin Nexa vê todas.
CREATE OR REPLACE FUNCTION private.empresas_do_usuario(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.empresas WHERE private.is_nexa_admin(_user_id)
  UNION
  SELECT empresa_id FROM public.usuarios_empresa WHERE user_id = _user_id;
$$;

-- Empresa ativa da requisição.
-- Vem do cabeçalho x-empresa-id (o PostgREST expõe em request.headers) e só vale se o usuário
-- tiver acesso a ela. Sem cabeçalho, usa a única empresa do usuário; com várias, fica nula
-- (nada é lido nem gravado até o usuário escolher).
CREATE OR REPLACE FUNCTION private.empresa_ativa()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  bruto text;
  pedida uuid;
  unica uuid;
  total int;
BEGIN
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;

  bruto := nullif(current_setting('request.headers', true), '')::json ->> 'x-empresa-id';
  IF bruto IS NOT NULL AND bruto ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    pedida := bruto::uuid;
    IF EXISTS (SELECT 1 FROM public.usuarios_empresa WHERE user_id = uid AND empresa_id = pedida)
       OR (private.is_nexa_admin(uid) AND EXISTS (SELECT 1 FROM public.empresas WHERE id = pedida)) THEN
      RETURN pedida;
    END IF;
    RETURN NULL;
  END IF;

  SELECT count(*), min(empresa_id::text)::uuid INTO total, unica
    FROM public.usuarios_empresa WHERE user_id = uid;
  IF total = 1 AND NOT private.is_nexa_admin(uid) THEN
    RETURN unica;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.tem_papel_na_empresa(_empresa_id uuid, _papel public.papel_empresa)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.is_nexa_admin()
      OR EXISTS (
        SELECT 1 FROM public.usuarios_empresa
         WHERE user_id = auth.uid() AND empresa_id = _empresa_id AND papel = _papel
      );
$$;

-- Funções antigas passam a olhar a empresa ativa (antes: "a primeira empresa" / "qualquer empresa").
CREATE OR REPLACE FUNCTION private.minha_empresa()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.empresa_ativa();
$$;

CREATE OR REPLACE FUNCTION private.meu_papel()
RETURNS public.papel_empresa LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN private.is_nexa_admin() THEN 'admin'::public.papel_empresa
    ELSE (SELECT papel FROM public.usuarios_empresa
           WHERE user_id = auth.uid() AND empresa_id = private.empresa_ativa())
  END;
$$;

CREATE OR REPLACE FUNCTION private.tem_papel(_papel public.papel_empresa)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.empresa_ativa() IS NOT NULL
     AND private.tem_papel_na_empresa(private.empresa_ativa(), _papel);
$$;

-- "Equipe" = alguém com acesso à empresa ativa (substitui o papel global legado).
CREATE OR REPLACE FUNCTION private.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id = auth.uid() AND private.empresa_ativa() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION private.is_nexa_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.empresa_ativa() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.tem_papel_na_empresa(uuid, public.papel_empresa) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_nexa_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.empresa_ativa() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.tem_papel_na_empresa(uuid, public.papel_empresa) TO authenticated, service_role;

-- Funções expostas ao app (PostgREST só publica o schema public).
CREATE OR REPLACE FUNCTION public.sou_admin_nexa()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private AS $$
  SELECT private.is_nexa_admin();
$$;
CREATE OR REPLACE FUNCTION public.empresa_ativa()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private AS $$
  SELECT private.empresa_ativa();
$$;
REVOKE ALL ON FUNCTION public.sou_admin_nexa() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.empresa_ativa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sou_admin_nexa() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.empresa_ativa() TO authenticated, service_role;

-- ---------------------------------------------------------------- 2. Unicidades por empresa
ALTER TABLE public.app_settings DROP CONSTRAINT app_settings_pkey;
ALTER TABLE public.app_settings ADD PRIMARY KEY (empresa_id, key);

ALTER TABLE public.work_orders DROP CONSTRAINT work_orders_os_number_key;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_empresa_os_number_key UNIQUE (empresa_id, os_number);

ALTER TABLE public.monthly_goals DROP CONSTRAINT monthly_goals_month_key;
ALTER TABLE public.monthly_goals ADD CONSTRAINT monthly_goals_empresa_month_key UNIQUE (empresa_id, month);

DROP INDEX public.crm_campaigns_ad_external_id_key;
CREATE UNIQUE INDEX crm_campaigns_ad_external_id_key
  ON public.crm_campaigns (empresa_id, ad_external_id) WHERE ad_external_id IS NOT NULL;

DROP INDEX public.expenses_reference_key_unique;
CREATE UNIQUE INDEX expenses_reference_key_unique
  ON public.expenses (empresa_id, reference_key) WHERE reference_key IS NOT NULL AND deleted_at IS NULL;

DROP INDEX public.recurring_expenses_seed_key_unique;
CREATE UNIQUE INDEX recurring_expenses_seed_key_unique
  ON public.recurring_expenses (empresa_id, seed_key) WHERE seed_key IS NOT NULL;

DROP INDEX public.whatsapp_contacts_normalized_phone_key;
CREATE UNIQUE INDEX whatsapp_contacts_normalized_phone_key
  ON public.whatsapp_contacts (empresa_id, normalized_phone);
DROP INDEX public.whatsapp_contacts_wa_id_key;
CREATE UNIQUE INDEX whatsapp_contacts_wa_id_key
  ON public.whatsapp_contacts (empresa_id, wa_id) WHERE wa_id IS NOT NULL;

DROP INDEX public.whatsapp_messages_wamid_key;
CREATE UNIQUE INDEX whatsapp_messages_wamid_key
  ON public.whatsapp_messages (empresa_id, whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;

-- ---------------------------------------------------------------- 3 e 4. empresa_id + referências
-- Gatilho que impede um registro de apontar para outro de outra empresa.
-- (Chaves estrangeiras compostas fariam o mesmo, mas quebram as consultas embutidas do
-- PostgREST que o app usa, como customer:customer_id(...).)
-- SECURITY DEFINER para enxergar a empresa real do registro referenciado, mesmo que o RLS
-- o esconda do usuário.
CREATE OR REPLACE FUNCTION private.validar_empresa_referencias()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i int := 0;
  coluna text;
  tabela text;
  valor uuid;
  empresa_ref uuid;
BEGIN
  WHILE i < TG_NARGS LOOP
    coluna := TG_ARGV[i];
    tabela := TG_ARGV[i + 1];
    i := i + 2;
    EXECUTE format('SELECT ($1).%I', coluna) INTO valor USING NEW;
    CONTINUE WHEN valor IS NULL;
    EXECUTE format('SELECT empresa_id FROM public.%I WHERE id = $1', tabela) INTO empresa_ref USING valor;
    IF empresa_ref IS NOT NULL AND empresa_ref IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'Referência inválida: %.% aponta para um registro de outra empresa', TG_TABLE_NAME, coluna
        USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.validar_empresa_referencias() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t record;
  fk record;
  args text;
BEGIN
  -- Toda tabela de negócio: empresa_id vem da empresa ativa (sem valor fixo).
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'empresa_id'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN empresa_id SET DEFAULT private.empresa_ativa()', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN empresa_id SET NOT NULL', t.table_name);
  END LOOP;

  -- Um gatilho por tabela, cobrindo todas as FKs simples para outras tabelas de negócio.
  FOR fk IN
    SELECT con.conrelid::regclass AS filho,
           replace(con.conrelid::regclass::text, 'public.', '') AS filho_nome,
           string_agg(
             quote_literal((SELECT attname FROM pg_attribute WHERE attrelid = con.conrelid AND attnum = con.conkey[1]))
             || ', ' || quote_literal(replace(con.confrelid::regclass::text, 'public.', '')),
             ', ' ORDER BY con.conname) AS pares
      FROM pg_constraint con
     WHERE con.contype = 'f'
       AND con.connamespace = 'public'::regnamespace
       AND array_length(con.conkey, 1) = 1
       AND con.confrelid <> 'public.empresas'::regclass
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = con.conrelid AND attname = 'empresa_id' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = con.confrelid AND attname = 'empresa_id' AND NOT attisdropped)
     GROUP BY con.conrelid
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_valida_empresa BEFORE INSERT OR UPDATE ON %s
         FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(%s)',
      fk.filho_nome, fk.filho, fk.pares);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- 5. RLS pela empresa ativa
DO $$
DECLARE
  t record;
  pol record;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'empresa_id' AND tb.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('usuarios_empresa', 'convites_empresa')
  LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t.table_name LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t.table_name);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (empresa_id = (SELECT private.empresa_ativa()))
         WITH CHECK (empresa_id = (SELECT private.empresa_ativa()))',
      t.table_name || '_empresa_ativa', t.table_name);
  END LOOP;
END $$;

-- Históricos continuam somente-inclusão.
REVOKE UPDATE, DELETE ON public.expense_status_history FROM authenticated;

-- Empresas: lista as acessíveis; só admin da própria empresa (ou Nexa) altera.
DROP POLICY IF EXISTS empresas_select ON public.empresas;
DROP POLICY IF EXISTS empresas_update ON public.empresas;
CREATE POLICY empresas_select ON public.empresas FOR SELECT TO authenticated
  USING (id IN (SELECT private.empresas_do_usuario(auth.uid())));
CREATE POLICY empresas_update ON public.empresas FOR UPDATE TO authenticated
  USING (private.tem_papel_na_empresa(id, 'admin'))
  WITH CHECK (private.tem_papel_na_empresa(id, 'admin'));

-- Vínculos: o usuário vê os próprios e os da empresa ativa; admin da empresa gerencia.
DROP POLICY IF EXISTS usuarios_empresa_select ON public.usuarios_empresa;
DROP POLICY IF EXISTS usuarios_empresa_admin_write ON public.usuarios_empresa;
DROP POLICY IF EXISTS usuarios_empresa_admin_delete ON public.usuarios_empresa;
CREATE POLICY usuarios_empresa_select ON public.usuarios_empresa FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR empresa_id = (SELECT private.empresa_ativa()) OR private.is_nexa_admin());
CREATE POLICY usuarios_empresa_admin_update ON public.usuarios_empresa FOR UPDATE TO authenticated
  USING (private.tem_papel_na_empresa(empresa_id, 'admin'))
  WITH CHECK (private.tem_papel_na_empresa(empresa_id, 'admin'));
CREATE POLICY usuarios_empresa_admin_delete ON public.usuarios_empresa FOR DELETE TO authenticated
  USING (private.tem_papel_na_empresa(empresa_id, 'admin'));

DROP POLICY IF EXISTS convites_all ON public.convites_empresa;
CREATE POLICY convites_admin ON public.convites_empresa FOR ALL TO authenticated
  USING (private.tem_papel_na_empresa(empresa_id, 'admin'))
  WITH CHECK (private.tem_papel_na_empresa(empresa_id, 'admin'));

-- Perfis: o próprio, colegas da empresa ativa e a Nexa (antes: qualquer "admin" global via
-- papel legado lia todos os perfis de todas as empresas).
DROP POLICY IF EXISTS profiles_read ON public.users_profiles;
DROP POLICY IF EXISTS profiles_update ON public.users_profiles;
CREATE POLICY profiles_read ON public.users_profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR private.is_nexa_admin()
    OR id IN (SELECT user_id FROM public.usuarios_empresa WHERE empresa_id = (SELECT private.empresa_ativa()))
  );
CREATE POLICY profiles_update ON public.users_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR private.is_nexa_admin())
  WITH CHECK (id = auth.uid() OR private.is_nexa_admin());

-- ---------------------------------------------------------------- 6. Funções de cadastro
-- Convite: sempre para a empresa ativa, só por admin dela.
CREATE OR REPLACE FUNCTION private.convidar_usuario(_email text, _papel public.papel_empresa)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp uuid := private.empresa_ativa();
  alvo uuid;
  convite_id uuid;
BEGIN
  IF emp IS NULL OR NOT private.tem_papel_na_empresa(emp, 'admin') THEN
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

-- Cadastro público só aceita convites; empresas novas são criadas pela Nexa.
CREATE OR REPLACE FUNCTION private.registrar_empresa(_nome text, _cnpj text DEFAULT NULL, _telefone text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  atual uuid;
  convite public.convites_empresa;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = uid;
  INSERT INTO public.users_profiles (id, full_name, email)
  VALUES (uid, COALESCE((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = uid), split_part(uemail,'@',1)), uemail)
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

  SELECT empresa_id INTO atual FROM public.usuarios_empresa WHERE user_id = uid ORDER BY created_at LIMIT 1;
  IF atual IS NOT NULL THEN RETURN atual; END IF;

  IF private.is_nexa_admin(uid) THEN
    RETURN private.provisionar_empresa(_nome, _cnpj, _telefone, NULL);
  END IF;

  RAISE EXCEPTION 'O cadastro de empresas é feito pela Nexa. Peça um convite ao administrador.';
END $$;

CREATE OR REPLACE FUNCTION private.ensure_my_access()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

-- Consumo de produto: o produto precisa ser da empresa ativa (antes a baixa de estoque
-- podia atingir produto de outra empresa).
CREATE OR REPLACE FUNCTION private.registrar_consumo_produto(
  _work_order_id uuid, _visit_id uuid, _produto_id uuid, _quantidade_ml numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp uuid := private.empresa_ativa();
  p RECORD;
  novo_id uuid;
BEGIN
  IF emp IS NULL THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _quantidade_ml IS NULL OR _quantidade_ml <= 0 THEN
    RAISE EXCEPTION 'quantidade invalida';
  END IF;
  SELECT id, nome, custo_por_ml INTO p FROM public.produtos WHERE id = _produto_id AND empresa_id = emp;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'produto nao encontrado';
  END IF;

  INSERT INTO public.os_produtos_utilizados
    (empresa_id, work_order_id, visit_id, produto_id, produto_nome, quantidade_ml, custo_por_ml_snapshot, custo_calculado, created_by)
  VALUES
    (emp, _work_order_id, _visit_id, p.id, p.nome, _quantidade_ml, COALESCE(p.custo_por_ml, 0),
     ROUND(COALESCE(p.custo_por_ml, 0) * _quantidade_ml, 2), auth.uid())
  RETURNING id INTO novo_id;

  UPDATE public.produtos
     SET estoque_atual_ml = GREATEST(estoque_atual_ml - _quantidade_ml, 0)
   WHERE id = p.id AND empresa_id = emp;

  RETURN novo_id;
END $$;

-- ---------------------------------------------------------------- 7. Configurações e comissão
CREATE TABLE public.configuracoes_plataforma (
  chave text PRIMARY KEY,
  valor jsonb NOT NULL,
  descricao text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.configuracoes_plataforma ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.configuracoes_plataforma TO authenticated;
GRANT ALL ON public.configuracoes_plataforma TO service_role;
CREATE POLICY configuracoes_plataforma_nexa ON public.configuracoes_plataforma FOR ALL TO authenticated
  USING (private.is_nexa_admin()) WITH CHECK (private.is_nexa_admin());
CREATE TRIGGER trg_configuracoes_plataforma_upd BEFORE UPDATE ON public.configuracoes_plataforma
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.configuracoes_plataforma (chave, valor, descricao) VALUES
  ('comissao_percentual_padrao', '5', 'Percentual de comissão da Nexa para empresas novas'),
  ('empresa_modelo_id', '"11111111-1111-1111-1111-111111111111"',
   'Empresa cujos catálogos (status, origens, taxas, parâmetros) são copiados para empresas novas');

-- Contrato de comissão da Nexa com cada empresa, com vigência (mudança = nova vigência).
CREATE TABLE public.contratos_comissao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  percentual numeric(6,3) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
  base text NOT NULL DEFAULT 'recebido_servico_realizado'
    CHECK (base IN ('recebido_servico_realizado')),
  somente_atendentes_nexa boolean NOT NULL DEFAULT true,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  observacoes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE (empresa_id, vigencia_inicio)
);
CREATE UNIQUE INDEX contratos_comissao_um_vigente ON public.contratos_comissao (empresa_id) WHERE vigencia_fim IS NULL;
ALTER TABLE public.contratos_comissao ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contratos_comissao TO authenticated;
GRANT ALL ON public.contratos_comissao TO service_role;
CREATE POLICY contratos_comissao_select ON public.contratos_comissao FOR SELECT TO authenticated
  USING (private.tem_papel_na_empresa(empresa_id, 'admin'));
CREATE POLICY contratos_comissao_nexa_insert ON public.contratos_comissao FOR INSERT TO authenticated
  WITH CHECK (private.is_nexa_admin());
CREATE POLICY contratos_comissao_nexa_update ON public.contratos_comissao FOR UPDATE TO authenticated
  USING (private.is_nexa_admin()) WITH CHECK (private.is_nexa_admin());
CREATE POLICY contratos_comissao_nexa_delete ON public.contratos_comissao FOR DELETE TO authenticated
  USING (private.is_nexa_admin());
CREATE TRIGGER trg_contratos_comissao_upd BEFORE UPDATE ON public.contratos_comissao
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Altera o percentual a partir de uma data: encerra o contrato vigente e abre outro.
CREATE OR REPLACE FUNCTION private.definir_comissao_empresa(_empresa_id uuid, _percentual numeric, _inicio date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  atual public.contratos_comissao;
  novo uuid;
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'apenas a Nexa altera a comissão';
  END IF;
  IF _inicio IS NULL THEN _inicio := CURRENT_DATE; END IF;

  SELECT * INTO atual FROM public.contratos_comissao
   WHERE empresa_id = _empresa_id AND vigencia_fim IS NULL FOR UPDATE;

  IF atual.id IS NOT NULL THEN
    -- Mesma data de início: correção do percentual da vigência atual.
    IF _inicio = atual.vigencia_inicio THEN
      UPDATE public.contratos_comissao SET percentual = _percentual WHERE id = atual.id;
      RETURN atual.id;
    END IF;
    IF _inicio < atual.vigencia_inicio THEN
      RAISE EXCEPTION 'a nova vigência precisa começar depois de %', atual.vigencia_inicio;
    END IF;
    UPDATE public.contratos_comissao SET vigencia_fim = _inicio - 1 WHERE id = atual.id;
  END IF;

  INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio,
    somente_atendentes_nexa, base)
  VALUES (_empresa_id, _percentual, _inicio,
    COALESCE(atual.somente_atendentes_nexa, true), COALESCE(atual.base, 'recebido_servico_realizado'))
  RETURNING id INTO novo;
  RETURN novo;
END $$;

-- Atendentes da Nexa entre os vendedores da empresa (base da comissão).
ALTER TABLE public.salespeople
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN atendente_nexa boolean NOT NULL DEFAULT false;
UPDATE public.salespeople SET atendente_nexa = true
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND name IN ('Maria', 'Carol');

-- Turbine Clean: 3% (decisão D5). Demais empresas usam o padrão da plataforma.
INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio, observacoes, created_by)
VALUES ('11111111-1111-1111-1111-111111111111', 3, DATE '2026-01-01', 'Contrato inicial', NULL);

-- Parâmetros de CRM por empresa.
INSERT INTO public.app_settings (empresa_id, key, value)
VALUES ('11111111-1111-1111-1111-111111111111', 'crm_novo_lead_apos_dias', '30')
ON CONFLICT (empresa_id, key) DO NOTHING;

-- Cria uma empresa cliente com os catálogos da empresa-modelo e o contrato padrão.
CREATE OR REPLACE FUNCTION private.provisionar_empresa(
  _nome text, _cnpj text DEFAULT NULL, _telefone text DEFAULT NULL, _percentual_comissao numeric DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nova uuid;
  modelo uuid;
  pct numeric;
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'apenas a Nexa cadastra empresas';
  END IF;
  IF _nome IS NULL OR length(trim(_nome)) < 2 THEN
    RAISE EXCEPTION 'informe o nome da empresa';
  END IF;

  SELECT (valor #>> '{}')::uuid INTO modelo FROM public.configuracoes_plataforma WHERE chave = 'empresa_modelo_id';
  SELECT (valor #>> '{}')::numeric INTO pct FROM public.configuracoes_plataforma WHERE chave = 'comissao_percentual_padrao';
  pct := COALESCE(_percentual_comissao, pct, 5);

  INSERT INTO public.empresas (nome, cnpj, telefone)
  VALUES (trim(_nome), nullif(trim(_cnpj), ''), nullif(trim(_telefone), ''))
  RETURNING id INTO nova;

  IF modelo IS NOT NULL THEN
    INSERT INTO public.config_options (empresa_id, kind, name, active, display_order, metadata)
    SELECT nova, kind, name, active, display_order, metadata
      FROM public.config_options WHERE empresa_id = modelo;

    INSERT INTO public.payment_rates (empresa_id, channel, payment_type, installments, rate_percent, active, effective_from)
    SELECT nova, channel, payment_type, installments, rate_percent, active, effective_from
      FROM public.payment_rates WHERE empresa_id = modelo AND active;

    -- Parâmetros de negócio; dados específicos da empresa-modelo (nome, integrações) não são copiados.
    INSERT INTO public.app_settings (empresa_id, key, value)
    SELECT nova, key, value FROM public.app_settings
     WHERE empresa_id = modelo
       AND key NOT IN ('company', 'os_document_settings', 'google_calendar_settings');
  END IF;

  INSERT INTO public.app_settings (empresa_id, key, value)
  VALUES (nova, 'company', jsonb_build_object('name', trim(_nome), 'document', COALESCE(_cnpj, ''), 'phone', COALESCE(_telefone, '')))
  ON CONFLICT (empresa_id, key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio, observacoes)
  VALUES (nova, pct, CURRENT_DATE, 'Contrato inicial');

  RETURN nova;
END $$;

REVOKE ALL ON FUNCTION private.provisionar_empresa(text, text, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.definir_comissao_empresa(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.provisionar_empresa(text, text, text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.definir_comissao_empresa(uuid, numeric, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provisionar_empresa(
  _nome text, _cnpj text DEFAULT NULL, _telefone text DEFAULT NULL, _percentual_comissao numeric DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public, private AS $$
  SELECT private.provisionar_empresa(_nome, _cnpj, _telefone, _percentual_comissao);
$$;
CREATE OR REPLACE FUNCTION public.definir_comissao_empresa(_empresa_id uuid, _percentual numeric, _inicio date DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public, private AS $$
  SELECT private.definir_comissao_empresa(_empresa_id, _percentual, _inicio);
$$;
REVOKE ALL ON FUNCTION public.provisionar_empresa(text, text, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.definir_comissao_empresa(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provisionar_empresa(text, text, text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.definir_comissao_empresa(uuid, numeric, date) TO authenticated, service_role;
