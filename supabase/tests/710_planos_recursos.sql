-- Planos novos (migração 20261215120000): recursos por plano com trava no banco, limite de
-- usuários (técnico não conta), Turbine (Interna) e Nexa Gestão com tudo, pedido de mudança de
-- plano. Dados fictícios.
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
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, false);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;
\set E '71000000-0000-4000-8000-000000000001'
\set G '71000000-0000-4000-8000-000000000002'
\set T '11111111-1111-1111-1111-111111111111'

SELECT pg_temp.ok((SELECT string_agg(codigo || ':' || preco_mensal::int || ':' || coalesce(limite_usuarios::text, '-'), ',' ORDER BY ordem)
                     FROM public.planos WHERE ativo) = 'essencial:97:3,profissional:247:6,profissional_alice:497:6,nexa_gestao:497:-,interna:0:-',
  'catálogo novo');
SELECT pg_temp.ok((SELECT NOT publico FROM public.planos WHERE codigo = 'nexa_gestao'), 'Nexa Gestão fora da tabela pública');
SELECT pg_temp.ok((SELECT NOT ativo FROM public.planos WHERE codigo = 'basico'), 'Básico inativo');

INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Essencial 710'), (:'G', 'Gestão 710');
INSERT INTO public.assinaturas (empresa_id, plano_id, status, vigencia_inicio)
SELECT :'E', id, 'ativa', private.hoje_sp() - 10 FROM public.planos WHERE codigo = 'essencial';
INSERT INTO public.assinaturas (empresa_id, plano_id, status, vigencia_inicio, gratis_ate)
SELECT :'G', id, 'trial', private.hoje_sp() - 10, private.hoje_sp() + 60 FROM public.planos WHERE codigo = 'nexa_gestao';

-- Recursos.
SELECT pg_temp.ok(NOT private.empresa_tem_recurso(:'E', 'cupons') AND NOT private.empresa_tem_recurso(:'E', 'alice'),
  'Essencial sem cupons nem Alice');
SELECT pg_temp.ok((SELECT bool_and(private.empresa_tem_recurso(e, r))
                     FROM unnest(ARRAY[:'T', :'G']::uuid[]) e,
                          unnest(ARRAY['caixa_entrada','crm','deslocamento_rotas','cupons','marketing','vendas_origem','dre_comissoes','alice']) r),
  'Turbine (Interna) e Nexa Gestão com tudo');

-- Usuários: admin + 2 atendentes = 3 (limite do Essencial); técnico não conta.
INSERT INTO auth.users (email) VALUES ('a710@e.test'), ('b710@e.test'), ('c710@e.test'), ('d710@e.test'), ('t710@e.test'), ('t2710@e.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E', (CASE email WHEN 'a710@e.test' THEN 'admin' ELSE 'atendente' END)::public.papel_empresa
  FROM auth.users WHERE email IN ('a710@e.test', 'b710@e.test', 'c710@e.test');
SELECT pg_temp.deve_falhar($$INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
  SELECT id, '71000000-0000-4000-8000-000000000001', 'atendente' FROM auth.users WHERE email = 'd710@e.test'$$,
  '4º usuário no Essencial');
SELECT pg_temp.deve_falhar($$INSERT INTO public.convites_empresa (empresa_id, email, papel)
  VALUES ('71000000-0000-4000-8000-000000000001', 'novo710@e.test', 'admin')$$, 'convite além do limite');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E', 'tecnico' FROM auth.users WHERE email IN ('t710@e.test', 't2710@e.test');
INSERT INTO public.convites_empresa (empresa_id, email, papel) VALUES (:'E', 'tec710@e.test', 'tecnico');
SELECT pg_temp.ok(private.usuarios_que_contam(:'E') = 3, 'técnicos e convite de técnico não contam');
SELECT pg_temp.deve_falhar($$UPDATE public.usuarios_empresa SET papel = 'atendente'
  WHERE user_id = (SELECT id FROM auth.users WHERE email = 't710@e.test')$$, 'técnico virando atendente além do limite');
-- Usuário extra libera mais um.
UPDATE public.assinaturas SET usuarios_extras = 1 WHERE empresa_id = :'E';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E', 'atendente' FROM auth.users WHERE email = 'd710@e.test';
SELECT pg_temp.ok(private.usuarios_que_contam(:'E') = 4, 'com 1 usuário extra, 4');

-- Travas da tela (como admin do Essencial).
SELECT pg_temp.como('a710@e.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT (public.plano_da_empresa()->>'plano') = 'essencial'
                          AND (public.plano_da_empresa()->>'limite_usuarios')::int = 4
                          AND jsonb_array_length(public.plano_da_empresa()->'planos') = 3), 'plano da empresa e planos públicos');
SELECT pg_temp.ok(NOT public.tem_recurso('cupons') AND public.tem_recurso('cupons') IS NOT NULL, 'tem_recurso da empresa aberta');
DO $$ BEGIN
  PERFORM public.empresa_tem_recurso('71000000-0000-4000-8000-000000000001', 'cupons');
  RAISE EXCEPTION 'FALHOU: usuário consultou recurso de empresa qualquer';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT pg_temp.deve_falhar($$INSERT INTO public.cupons (empresa_id, codigo, valor, servico)
  VALUES ('71000000-0000-4000-8000-000000000001', 'ESS10', 10, 'higienizacao')$$, 'cupom no Essencial');
SELECT pg_temp.deve_falhar($$INSERT INTO public.ia_configuracoes (empresa_id, ativo) VALUES ('71000000-0000-4000-8000-000000000001', true)$$,
  'ligar a Alice no Essencial');
SELECT pg_temp.deve_falhar($$INSERT INTO public.orcamento_configuracoes (empresa_id, distancia_ligado) VALUES ('71000000-0000-4000-8000-000000000001', true)$$,
  'ligar a taxa de deslocamento no Essencial');
INSERT INTO public.orcamento_configuracoes (empresa_id, sujidade_ligado) VALUES (:'E', true);
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.orcamento_configuracoes WHERE empresa_id = :'E'), 'regras do Essencial gravam');
-- Pedido de mudança de plano.
INSERT INTO public.pedidos_plano (recurso, plano_sugerido) VALUES ('cupons', 'profissional');
UPDATE public.pedidos_plano SET visto_em = now();
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.pedidos_plano WHERE empresa_id = :'E' AND visto_em IS NULL) = 1,
  'empresa não marca o pedido como visto (só a Nexa)');
ROLLBACK;
