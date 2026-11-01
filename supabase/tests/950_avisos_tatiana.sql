-- Avisar a Tatiana (migração 20261228350000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, false);
$$;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set E '95000000-0000-4000-8000-00000000000e'
\set E2 '95000000-0000-4000-8000-00000000002e'
\set C1 '95000000-0000-4000-8000-0000000000c1'
\set C2 '95000000-0000-4000-8000-0000000000c2'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 950'), (:'E2', 'Outra Fictícia 950');
INSERT INTO auth.users (email) VALUES ('dona@p950.test'), ('maria@p950.test'), ('carol@p950.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'dona@p950.test'
UNION ALL SELECT id, :'E'::uuid, 'atendente'::papel_empresa FROM auth.users WHERE email = 'maria@p950.test'
UNION ALL SELECT id, :'E'::uuid, 'atendente'::papel_empresa FROM auth.users WHERE email = 'carol@p950.test';
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('95000000-0000-4000-8000-0000000000a9', 'Fictícia', 195095, 'token-950');
INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id, status)
VALUES (:'C1', :'E', '95000000-0000-4000-8000-0000000000a9', 95001, 'open'),
       (:'C2', :'E2', '95000000-0000-4000-8000-0000000000a9', 95002, 'open');

SELECT pg_temp.como('maria@p950.test', :'E');
SET ROLE authenticated;
SELECT public.comercial_avisar(:'C1', 'erro', 'A Alice pediu o nome junto com a foto e o CEP.');
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_avisos) = 1, 'Maria vê o aviso dela');
DO $$ BEGIN
  INSERT INTO public.comercial_avisos (empresa_id, user_id, tipo, frase)
  VALUES ('95000000-0000-4000-8000-00000000000e', auth.uid(), 'erro', 'gravando direto');
  RAISE EXCEPTION 'FALHOU: gravou direto';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM public.comercial_avisar('95000000-0000-4000-8000-0000000000c2', 'erro', 'conversa de outra empresa');
  RAISE EXCEPTION 'FALHOU: avisou em conversa de outra empresa';
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  PERFORM public.comercial_avisar('95000000-0000-4000-8000-0000000000c1', 'talvez', 'tipo errado');
  RAISE EXCEPTION 'FALHOU: aceitou tipo errado';
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
END $$;
RESET ROLE;

SELECT pg_temp.como('carol@p950.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_avisos) = 0, 'Carol não vê o aviso da Maria');
SELECT public.comercial_avisar(:'C1', 'acerto', 'Boa: a Alice comentou a foto antes de pedir o CEP.');
RESET ROLE;

SELECT pg_temp.como('dona@p950.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_avisos) = 2, 'admin vê todos');
RESET ROLE;
ROLLBACK;
