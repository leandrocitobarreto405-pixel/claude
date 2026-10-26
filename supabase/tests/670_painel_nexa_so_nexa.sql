-- Painel Nexa no banco: tudo o que o painel lê e grava direto (funções e tabelas da plataforma)
-- recusa o admin de empresa que não é nexa_admin e não mostra dados de outra empresa.
-- Complementa src/lib/painel-nexa-servidor.test.ts (funções do servidor). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers',
           CASE WHEN _empresa IS NULL THEN '{}' ELSE json_build_object('x-empresa-id', _empresa)::text END, false);
$$;
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

INSERT INTO auth.users (email) VALUES ('admin670@turbine.test'), ('nexa670@nexa.test');
INSERT INTO public.plataforma_usuarios (user_id, papel)
SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa670@nexa.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, '11111111-1111-1111-1111-111111111111', 'admin' FROM auth.users WHERE email = 'admin670@turbine.test';

-- Outra empresa, com assinatura, fatura, contrato e evento do Chatwoot.
INSERT INTO public.empresas (id, nome) VALUES ('67000000-0000-4000-8000-000000000001', 'Outra 670');
INSERT INTO public.assinaturas (id, empresa_id, plano_id, valor_mensal, status, vigencia_inicio)
SELECT '67000000-0000-4000-8000-000000000002', '67000000-0000-4000-8000-000000000001', id, 50, 'ativa', current_date
  FROM public.planos WHERE codigo = 'basico';
INSERT INTO public.faturas (empresa_id, assinatura_id, competencia, valor, vencimento)
VALUES ('67000000-0000-4000-8000-000000000001', '67000000-0000-4000-8000-000000000002',
        date_trunc('month', current_date)::date, 50, current_date + 5);
INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio)
VALUES ('67000000-0000-4000-8000-000000000001', 5, current_date);
INSERT INTO public.integracao_eventos (evento, chave_dedup, empresa_id, payload)
VALUES ('message_created', 't670', '67000000-0000-4000-8000-000000000001', '{}');

SELECT pg_temp.como('admin670@turbine.test', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.ok(public.sou_admin_nexa() IS NOT TRUE, 'admin de empresa não é Nexa');
-- Funções do painel.
SELECT pg_temp.deve_falhar($$SELECT public.provisionar_empresa('Empresa 670', NULL, NULL, NULL)$$, 'cadastrar empresa');
SELECT pg_temp.deve_falhar($$SELECT public.definir_assinatura('67000000-0000-4000-8000-000000000001', 'basico', current_date, 10, 'ativa', NULL, NULL)$$, 'definir assinatura');
SELECT pg_temp.deve_falhar($$SELECT public.definir_assinatura('11111111-1111-1111-1111-111111111111', 'basico', current_date, 0, 'ativa', NULL, NULL)$$, 'definir a própria assinatura');
SELECT pg_temp.deve_falhar($$SELECT public.definir_comissao_empresa('11111111-1111-1111-1111-111111111111', 0, current_date)$$, 'mudar a própria comissão');
SELECT pg_temp.deve_falhar($$SELECT public.definir_segredos_chatwoot(gen_random_uuid(), 'x', 'y')$$, 'segredos do Chatwoot');
SELECT pg_temp.deve_falhar($$SELECT public.reprocessar_eventos_chatwoot(10)$$, 'reprocessar eventos');
SELECT pg_temp.ok((SELECT count(*) FROM public.chatwoot_conexoes_resumo()) = 0, 'resumo das conexões vazio');
-- Tabelas da plataforma: não grava.
SELECT pg_temp.deve_falhar($$INSERT INTO public.planos (codigo, nome) VALUES ('plano_x', 'Plano X')$$, 'criar plano');
UPDATE public.planos SET preco_mensal = 1 WHERE codigo = 'basico';
UPDATE public.configuracoes_plataforma SET valor = '"x"' WHERE chave = 'termos_url';
SELECT pg_temp.deve_falhar($$INSERT INTO public.configuracoes_plataforma (chave, valor) VALUES ('x670', '1')$$, 'criar configuração da plataforma');
SELECT pg_temp.deve_falhar($$INSERT INTO public.faturas (empresa_id, assinatura_id, competencia, valor, vencimento)
  SELECT empresa_id, id, date_trunc('month', current_date)::date, 1, current_date FROM public.assinaturas LIMIT 1$$, 'criar fatura');
SELECT pg_temp.deve_falhar($$INSERT INTO public.chatwoot_conexoes (nome, account_id) VALUES ('x', 1)$$, 'criar conexão do Chatwoot');
SELECT pg_temp.deve_falhar($$INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio)
  VALUES ('11111111-1111-1111-1111-111111111111', 0, current_date)$$, 'criar contrato de comissão');
-- Não vê nada da outra empresa.
SELECT pg_temp.ok((SELECT count(*) FROM public.empresas WHERE id = '67000000-0000-4000-8000-000000000001') = 0, 'empresa');
SELECT pg_temp.ok((SELECT count(*) FROM public.assinaturas WHERE empresa_id = '67000000-0000-4000-8000-000000000001') = 0, 'assinatura');
SELECT pg_temp.ok((SELECT count(*) FROM public.faturas WHERE empresa_id = '67000000-0000-4000-8000-000000000001') = 0, 'fatura');
SELECT pg_temp.ok((SELECT count(*) FROM public.contratos_comissao WHERE empresa_id = '67000000-0000-4000-8000-000000000001') = 0, 'contrato');
SELECT pg_temp.ok((SELECT count(*) FROM public.integracao_eventos WHERE empresa_id = '67000000-0000-4000-8000-000000000001') = 0, 'evento do Chatwoot');
SELECT pg_temp.ok((SELECT count(*) FROM public.pagamentos_eventos) = 0, 'eventos de pagamento');
RESET ROLE;
SELECT pg_temp.ok((SELECT preco_mensal FROM public.planos WHERE codigo = 'basico') = 50, 'preço do plano não mudou');
SELECT pg_temp.ok((SELECT valor IS DISTINCT FROM '"x"'::jsonb FROM public.configuracoes_plataforma WHERE chave = 'termos_url'),
  'configuração da plataforma não mudou');

-- A Nexa, sem empresa escolhida (Nexa (painel)), vê a outra empresa.
SELECT pg_temp.como('nexa670@nexa.test');
SET ROLE authenticated;
SELECT pg_temp.ok(public.sou_admin_nexa(), 'Nexa é Nexa');
SELECT pg_temp.ok((SELECT count(*) FROM public.assinaturas WHERE empresa_id = '67000000-0000-4000-8000-000000000001') = 1, 'Nexa vê a assinatura');
SELECT pg_temp.ok((SELECT count(*) FROM public.faturas WHERE empresa_id = '67000000-0000-4000-8000-000000000001') = 1, 'Nexa vê a fatura');
RESET ROLE;
ROLLBACK;
