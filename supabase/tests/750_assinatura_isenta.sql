-- Cobrança isenta e "em teste até" (migração 20261219120000). Dados fictícios.
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
CREATE FUNCTION pg_temp.como(_email text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;
\set E '75000000-0000-4000-8000-000000000001'

INSERT INTO auth.users (email) VALUES ('nexa750@nexa.test'), ('admin750@e.test');
INSERT INTO public.plataforma_usuarios (user_id, papel) SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa750@nexa.test';
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Cobrança 750');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) SELECT id, :'E', 'admin' FROM auth.users WHERE email = 'admin750@e.test';
INSERT INTO public.assinaturas (empresa_id, plano_id, status, vigencia_inicio, proximo_vencimento)
SELECT :'E', id, 'ativa', private.hoje_sp() - 40, private.hoje_sp() - 10 FROM public.planos WHERE codigo = 'profissional';

-- Empresa da tela não marca isenção.
SELECT pg_temp.como('admin750@e.test');
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.definir_cobranca('75000000-0000-4000-8000-000000000001', true);
  RAISE EXCEPTION 'FALHOU: empresa se isentou';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

-- Inadimplente vira em dia ao ficar isenta; isenta não gera fatura nem volta a ficar inadimplente.
UPDATE public.assinaturas SET status = 'inadimplente', inadimplente_desde = private.hoje_sp() - 10 WHERE empresa_id = :'E';
SELECT pg_temp.ok(private.empresa_situacao(:'E') = 'somente_leitura', 'antes: somente leitura');
SELECT pg_temp.como('nexa750@nexa.test');
SET ROLE authenticated;
SELECT public.definir_cobranca(:'E', true);
RESET ROLE;
SELECT pg_temp.ok((SELECT isenta AND status = 'ativa' AND inadimplente_desde IS NULL AND isenta_por IS NOT NULL
                     FROM public.assinaturas WHERE empresa_id = :'E'), 'isenta, em dia, com quem marcou');
SELECT pg_temp.ok(private.empresa_situacao(:'E') = 'ok', 'portão em dia');
SELECT pg_temp.deve_falhar($$UPDATE public.assinaturas SET status = 'inadimplente'
  WHERE empresa_id = '75000000-0000-4000-8000-000000000001'$$, 'isenta inadimplente');
SELECT pg_temp.deve_falhar($$INSERT INTO public.faturas (empresa_id, assinatura_id, valor, vencimento)
  SELECT empresa_id, id, 247, private.hoje_sp() FROM public.assinaturas
   WHERE empresa_id = '75000000-0000-4000-8000-000000000001'$$, 'fatura de isenta');

-- Troca de plano com outra data: a assinatura nova herda a isenção.
SELECT pg_temp.como('nexa750@nexa.test');
SET ROLE authenticated;
SELECT public.definir_assinatura(:'E', 'profissional_alice', private.hoje_sp());
RESET ROLE;
SELECT pg_temp.ok((SELECT isenta FROM public.assinaturas WHERE empresa_id = :'E' AND vigencia_fim IS NULL),
  'nova assinatura herdou a isenção');

-- Em teste até: trial com grátis até a data; tirar volta para ativa. Cobrar de novo tira a isenção.
SET ROLE authenticated;
SELECT public.definir_cobranca(:'E', false, true, private.hoje_sp() + 30);
RESET ROLE;
SELECT pg_temp.ok((SELECT NOT isenta AND status = 'trial' AND gratis_ate = private.hoje_sp() + 30
                          AND proximo_vencimento = private.hoje_sp() + 31 AND isenta_por IS NULL
                     FROM public.assinaturas WHERE empresa_id = :'E' AND vigencia_fim IS NULL), 'em teste 30 dias');
SET ROLE authenticated;
SELECT public.definir_cobranca(:'E', NULL, true, NULL);
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'ativa' AND gratis_ate IS NULL
                     FROM public.assinaturas WHERE empresa_id = :'E' AND vigencia_fim IS NULL), 'sem teste: ativa');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT situacao = 'ok' FROM public.situacao_cobranca_empresas() WHERE empresa_id = :'E'),
  'situação na lista');
RESET ROLE;
ROLLBACK;
