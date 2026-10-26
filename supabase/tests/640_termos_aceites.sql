-- Termos (migração 20261208120000): cada pessoa vê só o próprio aceite, a Nexa vê todos, ninguém
-- da tela grava (o servidor grava com o IP do pedido), um aceite por versão; versão começa vazia.
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
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers', '{}', false);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

INSERT INTO auth.users (email) VALUES ('a640@e.test'), ('b640@e.test'), ('nexa640@nexa.test');
INSERT INTO public.plataforma_usuarios (user_id, papel)
SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa640@nexa.test';

SELECT pg_temp.ok((SELECT valor = 'null'::jsonb FROM public.configuracoes_plataforma WHERE chave = 'termos_versao'),
  'versão começa vazia');

-- O servidor grava (com o IP do pedido); repetir a mesma versão não duplica.
INSERT INTO public.termos_aceites (user_id, versao, ip, navegador)
SELECT id, '2026-10', '203.0.113.10', 'Teste' FROM auth.users WHERE email IN ('a640@e.test', 'b640@e.test');
SELECT pg_temp.deve_falhar($$INSERT INTO public.termos_aceites (user_id, versao)
  SELECT id, '2026-10' FROM auth.users WHERE email = 'a640@e.test'$$, 'mesma versão duas vezes');

SELECT pg_temp.como('a640@e.test');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.termos_aceites) = 1, 'vê só o próprio aceite');
SELECT pg_temp.deve_falhar($$INSERT INTO public.termos_aceites (user_id, versao)
  VALUES (auth.uid(), '2026-11')$$, 'tela não grava aceite');
SELECT pg_temp.deve_falhar($$UPDATE public.termos_aceites SET ip = 'x'$$, 'tela não altera aceite');
RESET ROLE;
SELECT pg_temp.como('nexa640@nexa.test');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.termos_aceites WHERE versao = '2026-10') = 2, 'Nexa vê todos');
RESET ROLE;

SELECT pg_temp.ok((SELECT proconfig::text LIKE '%search_path%' FROM pg_proc
                    WHERE oid = 'private.validar_proximo_numero_os()'::regprocedure), 'search_path fixo');
ROLLBACK;
