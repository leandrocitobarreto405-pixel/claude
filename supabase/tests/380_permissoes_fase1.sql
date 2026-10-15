-- Permissões da fase 1 (RLS): despesas só do admin; técnico só vê os serviços dele. Fictício.
BEGIN;

CREATE FUNCTION pg_temp.como(_email text, _empresa uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text,
           false),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, false);
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

-- ---------------------------------------------------------------- dados
INSERT INTO auth.users (email) VALUES ('admin@p380.test'), ('atendente@p380.test'), ('tecnico@p380.test');
-- O gatilho de equipe cria/liga vendedora e técnico ao entrar na empresa.
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, '11111111-1111-1111-1111-111111111111', 'admin' FROM auth.users WHERE email = 'admin@p380.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, '11111111-1111-1111-1111-111111111111', 'atendente' FROM auth.users WHERE email = 'atendente@p380.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, '11111111-1111-1111-1111-111111111111', 'tecnico' FROM auth.users WHERE email = 'tecnico@p380.test';
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.technicians t JOIN auth.users u ON u.id = t.user_id WHERE u.email = 'tecnico@p380.test') = 1,
  'o convite como técnico já cria o cadastro ligado ao login');
INSERT INTO public.technicians (id, empresa_id, name, display_order)
VALUES ('d3800000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Outro Técnico', 99);

INSERT INTO public.customers (id, empresa_id, full_name, phone)
VALUES ('c3800000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente Fictício', '11970000380');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value)
VALUES ('e3800000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '38001', 'c3800000-0000-0000-0000-000000000001', 100);
INSERT INTO public.visits (id, empresa_id, work_order_id, technician_id, scheduled_date, scheduled_time, status)
VALUES
  ('f3800000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e3800000-0000-0000-0000-000000000001',
   (SELECT t.id FROM public.technicians t JOIN auth.users u ON u.id = t.user_id WHERE u.email = 'tecnico@p380.test'),
   current_date, '09:00', 'Agendado'),
  ('f3800000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e3800000-0000-0000-0000-000000000001',
   'd3800000-0000-0000-0000-000000000002', current_date, '11:00', 'Agendado'),
  ('f3800000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e3800000-0000-0000-0000-000000000001',
   NULL, current_date, '14:00', 'Agendado');
INSERT INTO public.expenses (empresa_id, description, category, competence_date, expected_amount, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'Despesa fictícia', 'Outros', current_date, 50, 'Pendente');

-- ---------------------------------------------------------------- admin vê e grava despesas
SELECT pg_temp.como('admin@p380.test');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.expenses WHERE description = 'Despesa fictícia') = 1, 'admin lê despesas');
INSERT INTO public.expenses (description, category, competence_date, expected_amount, status)
VALUES ('Despesa do admin', 'Outros', current_date, 10, 'Pendente');
SELECT pg_temp.ok((SELECT count(*) FROM public.visits WHERE id::text LIKE 'f3800000%') = 3, 'admin vê todos os serviços');
RESET ROLE;

-- ---------------------------------------------------------------- atendente: nada de despesas
SELECT pg_temp.como('atendente@p380.test');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.expenses) = 0, 'atendente não lê despesas (nem erro, nem linhas)');
SELECT pg_temp.deve_falhar(
  $$INSERT INTO public.expenses (description, category, competence_date, expected_amount, status)
    VALUES ('Tentativa', 'Outros', current_date, 10, 'Pendente')$$,
  'atendente não grava despesa');
SELECT pg_temp.ok((SELECT count(*) FROM public.recurring_expenses) = 0, 'atendente não lê recorrentes');
SELECT pg_temp.ok((SELECT count(*) FROM public.visits WHERE id::text LIKE 'f3800000%') = 3, 'atendente vê todos os serviços');
RESET ROLE;

-- ---------------------------------------------------------------- técnico: só os serviços dele
SELECT pg_temp.como('tecnico@p380.test');
SET ROLE authenticated;
SELECT pg_temp.ok(
  (SELECT array_agg(id ORDER BY id) FROM public.visits WHERE id::text LIKE 'f3800000%')
    = ARRAY['f3800000-0000-0000-0000-000000000001'::uuid],
  'técnico vê só o serviço dele (nem o do outro técnico, nem o sem técnico)');
UPDATE public.visits SET status = 'Em execução' WHERE id = 'f3800000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT status FROM public.visits WHERE id = 'f3800000-0000-0000-0000-000000000001') = 'Em execução',
  'técnico atualiza o serviço dele');
UPDATE public.visits SET status = 'Em execução' WHERE id = 'f3800000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((SELECT count(*) FROM public.expenses) = 0, 'técnico não lê despesas');
RESET ROLE;
SELECT pg_temp.ok((SELECT status FROM public.visits WHERE id = 'f3800000-0000-0000-0000-000000000002') = 'Agendado',
  'o serviço do outro técnico não mudou');

-- Técnico sem cadastro ligado: não vê nenhum serviço.
UPDATE public.technicians SET user_id = NULL WHERE user_id = (SELECT id FROM auth.users WHERE email = 'tecnico@p380.test');
SELECT pg_temp.como('tecnico@p380.test');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.visits) = 0, 'técnico sem cadastro ligado não vê serviços');
RESET ROLE;

ROLLBACK;
