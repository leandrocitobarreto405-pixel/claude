-- Agenda dos técnicos (migração 20261204120000): telefone validado e normalizado, envio desligado
-- por padrão, um envio por técnico e dia (teste à parte), modelo aguardando o "Ver agenda", técnico de outra empresa recusado e
-- leitura só do admin da própria empresa. Dados fictícios.
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set E '60000000-0000-0000-0000-00000000000e'
\set F '60000000-0000-0000-0000-00000000000f'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 600'), (:'F', 'Outra Fictícia 600');
INSERT INTO public.technicians (id, empresa_id, name) VALUES
  ('60000000-0000-0000-0000-0000000000a1', :'E', 'Técnico Fictício'),
  ('60000000-0000-0000-0000-0000000000a2', :'F', 'Técnico da Outra');

-- Telefone: com DDD, gravado normalizado; inválido é recusado; vazio fica sem telefone.
UPDATE public.technicians SET telefone = '(11) 97600-0001' WHERE id = '60000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.ok((SELECT telefone = '5511976000001' FROM public.technicians WHERE id = '60000000-0000-0000-0000-0000000000a1'),
  'telefone normalizado');
SELECT pg_temp.deve_falhar($$UPDATE public.technicians SET telefone = '97600-0001' WHERE id = '60000000-0000-0000-0000-0000000000a1'$$,
  'telefone sem DDD');
UPDATE public.technicians SET telefone = '  ' WHERE id = '60000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.ok((SELECT telefone IS NULL AND recebe_agenda FROM public.technicians WHERE id = '60000000-0000-0000-0000-0000000000a2'),
  'vazio vira sem telefone; recebe a agenda por padrão');

-- Desligado por padrão, às 18:00.
INSERT INTO public.agenda_configuracoes (empresa_id) VALUES (:'E') ON CONFLICT (empresa_id) DO NOTHING;
SELECT pg_temp.ok((SELECT NOT agenda_tecnicos_ativo AND agenda_tecnicos_hora = '18:00'
                     FROM public.agenda_configuracoes WHERE empresa_id = :'E'), 'nasce desligado às 18h');

-- Um envio por técnico e dia; o teste não conta.
INSERT INTO public.agenda_tecnicos_envios (empresa_id, tecnico_id, dia_agenda, servicos, situacao)
VALUES (:'E', '60000000-0000-0000-0000-0000000000a1', '2026-10-24', 2, 'enviado');
SELECT pg_temp.deve_falhar($$INSERT INTO public.agenda_tecnicos_envios (empresa_id, tecnico_id, dia_agenda)
  VALUES ('60000000-0000-0000-0000-00000000000e', '60000000-0000-0000-0000-0000000000a1', '2026-10-24')$$,
  'segundo envio no mesmo dia');
INSERT INTO public.agenda_tecnicos_envios (empresa_id, tecnico_id, dia_agenda, situacao, teste)
VALUES (:'E', '60000000-0000-0000-0000-0000000000a1', '2026-10-24', 'enviado', true);
SELECT pg_temp.ok((SELECT count(*) FROM public.agenda_tecnicos_envios WHERE empresa_id = :'E') = 2, 'teste à parte');
-- Fora da janela: modelo enviado, aguardando o "Ver agenda"; PDF e link não existem.
SELECT pg_temp.deve_falhar($$INSERT INTO public.agenda_tecnicos_envios (empresa_id, tecnico_id, dia_agenda, via, teste)
  VALUES ('60000000-0000-0000-0000-00000000000e', '60000000-0000-0000-0000-0000000000a1', '2026-10-26', 'modelo_pdf', true)$$,
  'meio com PDF');
INSERT INTO public.agenda_tecnicos_envios (empresa_id, tecnico_id, dia_agenda, via, situacao)
VALUES (:'E', '60000000-0000-0000-0000-0000000000a1', '2026-10-26', 'modelo', 'aguardando');
SELECT pg_temp.ok((SELECT count(*) FROM public.agenda_tecnicos_envios WHERE situacao = 'aguardando') = 1, 'aguardando o toque');

-- Técnico de outra empresa: recusado.
SELECT pg_temp.deve_falhar($$INSERT INTO public.agenda_tecnicos_envios (empresa_id, tecnico_id, dia_agenda)
  VALUES ('60000000-0000-0000-0000-00000000000e', '60000000-0000-0000-0000-0000000000a2', '2026-10-25')$$,
  'técnico de outra empresa');

-- Leitura: só o admin da própria empresa; ninguém grava pela tela.
INSERT INTO auth.users (email) VALUES ('admin600@e.test'), ('admin600@f.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E', 'admin' FROM auth.users WHERE email = 'admin600@e.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'F', 'admin' FROM auth.users WHERE email = 'admin600@f.test';
SELECT pg_temp.como('admin600@f.test', :'F');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.agenda_tecnicos_envios) = 0, 'outra empresa não lê');
SELECT pg_temp.deve_falhar($$INSERT INTO public.agenda_tecnicos_envios (empresa_id, tecnico_id, dia_agenda)
  VALUES ('60000000-0000-0000-0000-00000000000f', '60000000-0000-0000-0000-0000000000a2', '2026-10-25')$$,
  'tela não grava envio');
RESET ROLE;
SELECT pg_temp.como('admin600@e.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.agenda_tecnicos_envios) = 3, 'admin lê os da empresa');
RESET ROLE;
ROLLBACK;
