-- Recibo das notificações (migração 20261228180000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '86000000-0000-4000-8000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 860');
INSERT INTO auth.users (email) VALUES ('celular@p860.test');
INSERT INTO public.push_inscricoes (id, empresa_id, user_id, endpoint, p256dh, auth)
SELECT '86000000-0000-4000-8000-000000000001', :'E', id, 'https://web.push.apple.com/teste-860', repeat('a', 87), repeat('b', 22)
  FROM auth.users WHERE email = 'celular@p860.test';
SELECT public.push_registrar_envio('86000000-0000-4000-8000-000000000001', 201);
SELECT public.push_registrar_envio('86000000-0000-4000-8000-000000000001', 201);
SELECT pg_temp.ok((SELECT envios_sem_recibo = 2 AND ultimo_status = 201 AND ultimo_envio_em IS NOT NULL
                     FROM public.push_inscricoes WHERE id = '86000000-0000-4000-8000-000000000001'), 'conta os envios sem recibo');
SELECT pg_temp.ok(public.push_confirmar_recibo((SELECT recibo FROM public.push_inscricoes WHERE id = '86000000-0000-4000-8000-000000000001')), 'recibo achado');
SELECT pg_temp.ok((SELECT envios_sem_recibo = 0 AND confirmado_em IS NOT NULL
                     FROM public.push_inscricoes WHERE id = '86000000-0000-4000-8000-000000000001'), 'recibo zera a contagem');
SELECT pg_temp.ok(NOT public.push_confirmar_recibo(gen_random_uuid()), 'recibo desconhecido');
SELECT public.push_registrar_envio('86000000-0000-4000-8000-000000000001', 403);
SELECT pg_temp.ok((SELECT falhas = 1 AND ultimo_status = 403 FROM public.push_inscricoes WHERE id = '86000000-0000-4000-8000-000000000001'), 'falha conta');
ROLLBACK;
