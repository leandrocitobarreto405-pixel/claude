-- Testes de isolamento multiempresa. Rodam dentro de uma transação desfeita no final.
-- Qualquer asserção que falhar interrompe o script com erro (ON_ERROR_STOP).
BEGIN;

-- ---------------------------------------------------------------- helpers
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           CASE WHEN _email IS NULL THEN ''
                ELSE json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text END,
           false),
         set_config('request.headers',
           CASE WHEN _empresa IS NULL THEN '{}' ELSE json_build_object('x-empresa-id', _empresa)::text END,
           false);
$$;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

CREATE FUNCTION pg_temp.deve_falhar(_sql text, _msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (deveria ter sido bloqueado): %', _msg;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

-- ---------------------------------------------------------------- dados
INSERT INTO auth.users (email) VALUES
  ('nexa@nexa.test'), ('admin@turbine.test'), ('admin@b.test'), ('multi@nexa.test'), ('estranho@x.test');
-- users_profiles é criado pelo gatilho on_auth_user_created.
INSERT INTO public.plataforma_usuarios (user_id, papel)
SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa@nexa.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, '11111111-1111-1111-1111-111111111111', 'admin' FROM auth.users WHERE email = 'admin@turbine.test';

-- ---------------------------------------------------------------- Nexa cria a empresa B
SELECT pg_temp.como('nexa@nexa.test');
SET ROLE authenticated;
SELECT set_config('teste.b', public.provisionar_empresa('Cliente B', '00.000.000/0001-00', NULL, NULL)::text, false);
SELECT pg_temp.ok(
  (SELECT percentual FROM public.contratos_comissao WHERE empresa_id = current_setting('teste.b')::uuid) = 5,
  'empresa nova recebe o percentual padrão (5%)');
SELECT pg_temp.ok(
  (SELECT percentual FROM public.contratos_comissao
    WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND vigencia_fim IS NULL) = 3,
  'Turbine Clean tem contrato de 3%');
RESET ROLE;

SELECT pg_temp.ok(
  (SELECT count(*) FROM public.config_options WHERE empresa_id = current_setting('teste.b')::uuid) > 0,
  'catálogos copiados da empresa-modelo');
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.payment_rates WHERE empresa_id = current_setting('teste.b')::uuid) > 0,
  'taxas copiadas da empresa-modelo');

INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, current_setting('teste.b')::uuid, 'admin' FROM auth.users WHERE email = 'admin@b.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT u.id, e.id, 'atendente' FROM auth.users u, public.empresas e WHERE u.email = 'multi@nexa.test';

-- ---------------------------------------------------------------- Turbine grava seus dados
SELECT pg_temp.como('admin@turbine.test');
SET ROLE authenticated;
SELECT pg_temp.ok(public.empresa_ativa() = '11111111-1111-1111-1111-111111111111',
  'usuário de uma empresa só: empresa ativa sem cabeçalho');
INSERT INTO public.customers (full_name, phone) VALUES ('Cliente da Turbine', '11999990000');
INSERT INTO public.work_orders (os_number, customer_id)
SELECT '1842', id FROM public.customers WHERE full_name = 'Cliente da Turbine';
INSERT INTO public.produtos (nome, tipo_servico, volume_embalagem_ml, preco_pago, estoque_atual_ml)
VALUES ('Produto Turbine', 'higienizacao', 1000, 100, 1000);
SELECT pg_temp.ok((SELECT count(*) FROM public.empresas) = 1, 'Turbine só enxerga a própria empresa');
RESET ROLE;

-- ---------------------------------------------------------------- Empresa B
SELECT pg_temp.como('admin@b.test');
SET ROLE authenticated;
SELECT pg_temp.ok(public.empresa_ativa() = current_setting('teste.b')::uuid, 'empresa ativa de B');
SELECT pg_temp.ok((SELECT count(*) FROM public.customers) = 0, 'B não vê clientes da Turbine');
SELECT pg_temp.ok((SELECT count(*) FROM public.work_orders) = 0, 'B não vê OSs da Turbine');
SELECT pg_temp.ok((SELECT count(*) FROM public.produtos) = 0, 'B não vê produtos da Turbine');
SELECT pg_temp.ok((SELECT count(*) FROM public.users_profiles WHERE email = 'admin@turbine.test') = 0,
  'B não vê perfis de usuários da Turbine');

INSERT INTO public.customers (full_name, phone) VALUES ('Cliente de B', '11999990000');
INSERT INTO public.work_orders (os_number, customer_id)
SELECT '1842', id FROM public.customers WHERE full_name = 'Cliente de B';
SELECT pg_temp.ok((SELECT count(*) FROM public.work_orders WHERE os_number = '1842') = 1,
  'mesmo número de OS permitido em empresas diferentes');

INSERT INTO public.app_settings (key, value) VALUES ('tax_percent', '8')
ON CONFLICT (empresa_id, key) DO UPDATE SET value = EXCLUDED.value;
SELECT pg_temp.ok((SELECT value FROM public.app_settings WHERE key = 'tax_percent') = '8'::jsonb,
  'B tem configuração própria');

INSERT INTO public.whatsapp_contacts (normalized_phone) VALUES ('5511999990000');

SELECT pg_temp.deve_falhar(
  $q$INSERT INTO public.customers (empresa_id, full_name, phone)
     VALUES ('11111111-1111-1111-1111-111111111111', 'Intruso', '0')$q$,
  'B gravando com empresa_id da Turbine');
WITH u AS (
  UPDATE public.empresas SET nome = 'hack' WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1
) SELECT pg_temp.ok(count(*) = 0, 'B não altera a empresa Turbine') FROM u;
WITH u AS (
  UPDATE public.usuarios_empresa SET papel = 'tecnico'
   WHERE empresa_id = '11111111-1111-1111-1111-111111111111' RETURNING 1
) SELECT pg_temp.ok(count(*) = 0, 'B não altera vínculos da Turbine') FROM u;
SELECT pg_temp.deve_falhar(
  $q$SELECT public.registrar_consumo_produto(
       (SELECT id FROM public.work_orders LIMIT 1), NULL,
       (SELECT id FROM public.produtos LIMIT 1), 10)$q$,
  'consumo sem produto visível');
SELECT pg_temp.deve_falhar(
  $q$SELECT public.definir_comissao_empresa(public.empresa_ativa(), 1, CURRENT_DATE + 1)$q$,
  'cliente alterando a própria comissão');
SELECT pg_temp.deve_falhar(
  $q$INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio)
     VALUES (public.empresa_ativa(), 0, CURRENT_DATE + 10)$q$,
  'cliente criando contrato de comissão');
SELECT pg_temp.deve_falhar(
  $q$SELECT public.provisionar_empresa('Empresa pirata')$q$,
  'cliente criando empresa');
SELECT pg_temp.ok((SELECT count(*) FROM public.contratos_comissao) = 1,
  'admin de B vê só o contrato de B');
RESET ROLE;

-- Referência cruzada: B tenta vincular OS a cliente da Turbine (FK composta).
SELECT set_config('teste.cliente_turbine',
  (SELECT id::text FROM public.customers WHERE full_name = 'Cliente da Turbine'), false);
SELECT set_config('teste.produto_turbine',
  (SELECT id::text FROM public.produtos WHERE nome = 'Produto Turbine'), false);
SELECT pg_temp.como('admin@b.test');
SET ROLE authenticated;
SELECT pg_temp.deve_falhar(
  format($q$INSERT INTO public.work_orders (os_number, customer_id) VALUES ('9999', %L)$q$,
         current_setting('teste.cliente_turbine')),
  'OS de B apontando para cliente da Turbine');
SELECT pg_temp.deve_falhar(
  format($q$SELECT public.registrar_consumo_produto(
            (SELECT id FROM public.work_orders LIMIT 1), NULL, %L, 10)$q$,
         current_setting('teste.produto_turbine')),
  'B dando baixa no estoque de produto da Turbine');
RESET ROLE;
SELECT pg_temp.ok(
  (SELECT estoque_atual_ml FROM public.produtos WHERE nome = 'Produto Turbine') = 1000,
  'estoque da Turbine intacto');

-- Cabeçalho forjado: B pede a empresa Turbine.
SELECT pg_temp.como('admin@b.test', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.ok(public.empresa_ativa() IS NULL, 'cabeçalho de empresa sem vínculo é ignorado');
SELECT pg_temp.ok((SELECT count(*) FROM public.customers) = 0, 'cabeçalho forjado não lê nada');
SELECT pg_temp.deve_falhar(
  $q$INSERT INTO public.customers (full_name, phone) VALUES ('x', '0')$q$,
  'cabeçalho forjado não grava');
RESET ROLE;

-- ---------------------------------------------------------------- Usuário com duas empresas
SELECT pg_temp.como('multi@nexa.test');
SET ROLE authenticated;
SELECT pg_temp.ok(public.empresa_ativa() IS NULL, 'duas empresas e nenhum cabeçalho: nenhuma ativa');
SELECT pg_temp.ok((SELECT count(*) FROM public.customers) = 0, 'sem empresa ativa não lê dados');
SELECT pg_temp.deve_falhar(
  $q$SELECT public.convidar_usuario('novo@x.test', 'admin')$q$,
  'atendente convidando usuário');
RESET ROLE;
SELECT pg_temp.como('multi@nexa.test', current_setting('teste.b')::uuid);
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT string_agg(full_name, ',') FROM public.customers) = 'Cliente de B',
  'com cabeçalho de B lê só B');
RESET ROLE;

-- ---------------------------------------------------------------- Nexa
SELECT pg_temp.como('nexa@nexa.test', current_setting('teste.b')::uuid);
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.empresas) = 2, 'Nexa lista todas as empresas');
SELECT pg_temp.ok((SELECT string_agg(full_name, ',') FROM public.customers) = 'Cliente de B',
  'Nexa dentro de B vê só B');
SELECT public.definir_comissao_empresa(current_setting('teste.b')::uuid, 6, CURRENT_DATE + 30);
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.contratos_comissao
    WHERE empresa_id = current_setting('teste.b')::uuid AND vigencia_fim IS NULL AND percentual = 6) = 1,
  'nova vigência de comissão criada');
SELECT pg_temp.ok(
  (SELECT vigencia_fim FROM public.contratos_comissao
    WHERE empresa_id = current_setting('teste.b')::uuid AND percentual = 5) = CURRENT_DATE + 29,
  'vigência anterior encerrada na véspera');
SELECT public.definir_comissao_empresa(current_setting('teste.b')::uuid, 6.5, CURRENT_DATE + 30);
SELECT pg_temp.ok(
  (SELECT percentual FROM public.contratos_comissao
    WHERE empresa_id = current_setting('teste.b')::uuid AND vigencia_fim IS NULL) = 6.5,
  'mesma data de início corrige o percentual da vigência atual');
SELECT pg_temp.deve_falhar(
  $q$SELECT public.definir_comissao_empresa(current_setting('teste.b')::uuid, 7, CURRENT_DATE)$q$,
  'vigência nova começando antes da atual');
RESET ROLE;

-- ---------------------------------------------------------------- Chave de serviço sem empresa
SELECT pg_temp.como(NULL);
SET ROLE service_role;
SELECT pg_temp.deve_falhar(
  $q$INSERT INTO public.customers (full_name, phone) VALUES ('sem empresa', '0')$q$,
  'gravação com chave de serviço sem empresa_id explícito');
RESET ROLE;

-- ---------------------------------------------------------------- Cadastro sem convite
SELECT pg_temp.como('estranho@x.test');
SET ROLE authenticated;
SELECT pg_temp.deve_falhar(
  $q$SELECT public.registrar_empresa('Minha empresa')$q$,
  'cadastro público criando empresa');
SELECT pg_temp.ok((SELECT count(*) FROM public.empresas) = 0, 'estranho não vê empresas');
RESET ROLE;

ROLLBACK;
