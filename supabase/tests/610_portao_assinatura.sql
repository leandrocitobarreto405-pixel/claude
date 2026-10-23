-- Portão da assinatura (migração 20261205120000): carência de 7 dias, somente leitura depois,
-- empresa cancelada ou desativada não abre (menos para a Nexa), servidor continua gravando, a
-- reserva de disparos confere a situação e toda tabela com empresa_id tem a trava. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.deve_falhar(_sql text, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (deveria ter sido bloqueado): %', _msg;
END $$;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers',
           CASE WHEN _empresa IS NULL THEN '{}' ELSE json_build_object('x-empresa-id', _empresa)::text END, false);
$$;
CREATE FUNCTION pg_temp.situacao(_status text, _desde date) RETURNS void LANGUAGE sql AS $$
  UPDATE public.assinaturas SET status = _status, inadimplente_desde = _desde
   WHERE empresa_id = '61000000-0000-0000-0000-00000000000e';
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set E '61000000-0000-0000-0000-00000000000e'
INSERT INTO public.empresas (id, nome, implantacao_liberada_em) VALUES (:'E', 'Empresa Fictícia 610', now());
INSERT INTO auth.users (email) VALUES ('admin610@e.test'), ('nexa610@nexa.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E', 'admin' FROM auth.users WHERE email = 'admin610@e.test';
INSERT INTO public.plataforma_usuarios (user_id, papel)
SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa610@nexa.test';
INSERT INTO public.assinaturas (empresa_id, plano_id, status, vigencia_inicio)
SELECT :'E', id, 'ativa', private.hoje_sp() - 60 FROM public.planos WHERE codigo = 'completo';

-- Sem assinatura: liberada (regra de transição). Turbine (empresa do banco de teste) segue ok.
SELECT pg_temp.ok(private.empresa_situacao('11111111-1111-1111-1111-111111111111') = 'ok', 'Turbine ok');

-- Ativa: grava normalmente.
SELECT pg_temp.ok(private.empresa_situacao(:'E') = 'ok', 'ativa');
SELECT pg_temp.como('admin610@e.test', :'E');
SET ROLE authenticated;
INSERT INTO public.customers (empresa_id, full_name, phone) VALUES (:'E', 'Cliente Fictício 1', '11976100001');
RESET ROLE;

-- Inadimplente há 3 dias: carência (aviso, 5 dias para o somente leitura), ainda grava.
SELECT pg_temp.situacao('inadimplente', private.hoje_sp() - 3);
SELECT pg_temp.ok(private.empresa_situacao(:'E') = 'aviso', 'carência');
SELECT pg_temp.ok(private.empresa_operante(:'E'), 'Alice e envios seguem na carência');
SELECT pg_temp.como('admin610@e.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((public.situacao_assinatura('61000000-0000-0000-0000-00000000000e')->>'dias_para_somente_leitura')::int = 5,
  'aviso com os dias restantes');
INSERT INTO public.customers (empresa_id, full_name, phone) VALUES (:'E', 'Cliente Fictício 2', '11976100002');
RESET ROLE;

-- Inadimplente há 8 dias: somente leitura. Lê, não grava; o servidor grava; a Nexa grava.
SELECT pg_temp.situacao('inadimplente', private.hoje_sp() - 8);
SELECT pg_temp.ok(private.empresa_situacao(:'E') = 'somente_leitura', 'somente leitura');
SELECT pg_temp.ok(NOT private.empresa_operante(:'E'), 'Alice e envios pausados');
SELECT pg_temp.como('admin610@e.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.customers WHERE empresa_id = '61000000-0000-0000-0000-00000000000e') = 2,
  'continua lendo');
SELECT pg_temp.ok(NOT public.empresa_pode_gravar(), 'tela sabe que não pode gravar');
SELECT pg_temp.deve_falhar($$INSERT INTO public.customers (empresa_id, full_name, phone)
  VALUES ('61000000-0000-0000-0000-00000000000e', 'Cliente Fictício 3', '11976100003')$$, 'criar em somente leitura');
SELECT pg_temp.deve_falhar($$UPDATE public.customers SET full_name = 'Outro'
  WHERE empresa_id = '61000000-0000-0000-0000-00000000000e'$$, 'alterar em somente leitura');
SELECT pg_temp.deve_falhar($$DELETE FROM public.customers
  WHERE empresa_id = '61000000-0000-0000-0000-00000000000e'$$, 'apagar em somente leitura');
RESET ROLE;
-- Servidor (webhook): mensagem que chega continua sendo guardada.
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, profile_name)
VALUES ('61000000-0000-0000-0000-0000000000c1', :'E', '5511976100009', 'Perfil Fictício');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_type, text_content)
VALUES (:'E', '61000000-0000-0000-0000-0000000000c1', 'Recebida', 'Texto', 'Olá');
SELECT pg_temp.como('nexa610@nexa.test', :'E');
SET ROLE authenticated;
INSERT INTO public.customers (empresa_id, full_name, phone) VALUES (:'E', 'Cliente da Nexa', '11976100004');
RESET ROLE;

-- Cancelada: a empresa não abre para o usuário; a Nexa continua vendo.
SELECT pg_temp.situacao('cancelada', NULL);
SELECT pg_temp.como('admin610@e.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok(private.empresa_ativa() IS NULL, 'cancelada não abre');
SELECT pg_temp.ok((SELECT count(*) FROM public.customers) = 0, 'cancelada não lê');
SELECT pg_temp.ok(public.situacao_assinatura('61000000-0000-0000-0000-00000000000e')->>'situacao' = 'bloqueada',
  'a tela sabe o motivo');
RESET ROLE;
SELECT pg_temp.como('nexa610@nexa.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok(private.empresa_ativa() = '61000000-0000-0000-0000-00000000000e', 'Nexa abre');
RESET ROLE;

-- Empresa desativada (empresas.ativo = false): mesma regra, agora no banco.
SELECT pg_temp.situacao('ativa', NULL);
UPDATE public.empresas SET ativo = false WHERE id = :'E';
SELECT pg_temp.como('admin610@e.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok(private.empresa_ativa() IS NULL, 'desativada não abre');
RESET ROLE;
UPDATE public.empresas SET ativo = true WHERE id = :'E';

-- Toda tabela com empresa_id tem a trava (menos assinatura, contrato, leitura e aparelho).
SELECT pg_temp.ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
   WHERE c.table_schema = 'public' AND c.column_name = 'empresa_id' AND t.table_type = 'BASE TABLE'
     AND c.table_name NOT IN ('assinaturas', 'contratos_comissao', 'conversas_leituras',
                              'push_inscricoes', 'push_preferencias')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger g
                      WHERE g.tgrelid = format('public.%I', c.table_name)::regclass
                        AND g.tgname = 'trg_zz_somente_leitura')),
  'trava em todas as tabelas com empresa_id');

-- A reserva de disparos confere a situação da empresa.
SELECT pg_temp.ok(pg_get_functiondef('public.mkt_reservar_envios(integer,timestamp with time zone)'::regprocedure)
                  LIKE '%private.empresa_operante(emp.id)%', 'reserva confere a situação');
ROLLBACK;
