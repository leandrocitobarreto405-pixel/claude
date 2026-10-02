-- Notificações no celular: cada pessoa vê só os próprios celulares e preferências; ninguém grava
-- inscrição direto (só o servidor); o histórico de envios não repete.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'admin@push.dev'),
  ('00000000-0000-0000-0000-0000000000e2', 'tecnico@push.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'tecnico');
-- O servidor grava as inscrições.
INSERT INTO public.push_inscricoes (empresa_id, user_id, endpoint, p256dh, auth) VALUES
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1',
   'https://web.push.apple.com/aaa', repeat('B', 87), repeat('a', 22)),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e2',
   'https://fcm.googleapis.com/fcm/send/bbb', repeat('B', 87), repeat('a', 22));
INSERT INTO public.push_envios (empresa_id, user_id, tipo, ref, titulo)
VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1', 'teste', 'x', 'Teste');
DO $$ BEGIN
  INSERT INTO public.push_envios (empresa_id, user_id, tipo, ref, titulo)
  VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1', 'teste', 'x', 'Teste');
  RAISE EXCEPTION 'FALHOU: repetiu a mesma notificação';
EXCEPTION WHEN unique_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.push_inscricoes (empresa_id, user_id, endpoint, p256dh, auth)
  VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1',
          'http://inseguro', repeat('B', 87), repeat('a', 22));
  RAISE EXCEPTION 'FALHOU: aceitou endereço sem https';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Técnico: vê só o próprio celular; não grava inscrição direto; preferências só as dele.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.push_inscricoes) = 1, 'técnico vê só o próprio celular');
SELECT pg_temp.ok((SELECT count(*) FROM public.push_envios) = 0, 'técnico não vê envios do admin');
DO $$ BEGIN
  INSERT INTO public.push_inscricoes (empresa_id, user_id, endpoint, p256dh, auth)
  VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e2',
          'https://web.push.apple.com/zzz', repeat('B', 87), repeat('a', 22));
  RAISE EXCEPTION 'FALHOU: gravou inscrição sem passar pelo servidor';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
INSERT INTO public.push_preferencias (empresa_id, user_id, resumo_dia)
VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e2', true);
DO $$ BEGIN
  INSERT INTO public.push_preferencias (empresa_id, user_id)
  VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1');
  RAISE EXCEPTION 'FALHOU: técnico mexeu na preferência do admin';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DELETE FROM public.push_inscricoes WHERE endpoint LIKE '%apple%';
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.push_inscricoes) = 2, 'técnico não apagou o celular do admin');

-- Admin vê o dele e o histórico dele.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.push_inscricoes) = 1, 'admin vê só o próprio celular');
SELECT pg_temp.ok((SELECT count(*) FROM public.push_envios) = 1, 'admin vê o próprio histórico');
SELECT pg_temp.ok((SELECT count(*) FROM public.push_preferencias) = 0, 'admin não vê preferências do técnico');
RESET ROLE;

ROLLBACK;
