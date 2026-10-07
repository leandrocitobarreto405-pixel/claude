-- Usuários e Equipe: entrar como atendente/técnico liga (ou cria) a vendedora/técnico; mudar de
-- papel desativa o cadastro anterior; sem duplicar.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO auth.users (email) VALUES
  ('carol@equipe.test'), ('nova@equipe.test'), ('tec@equipe.test'), ('troca@equipe.test');
UPDATE public.users_profiles SET full_name = 'Nova Silva'
 WHERE id = (SELECT id FROM auth.users WHERE email = 'nova@equipe.test');
UPDATE public.users_profiles SET full_name = 'Pedro Técnico'
 WHERE id = (SELECT id FROM auth.users WHERE email = 'tec@equipe.test');

CREATE FUNCTION pg_temp.uid(_email text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM auth.users WHERE email = _email
$$;
CREATE FUNCTION pg_temp.vendedoras(_email text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(name || ':' || active, ','), '-') FROM public.salespeople
   WHERE user_id = pg_temp.uid(_email)
$$;
CREATE FUNCTION pg_temp.tecnicos(_email text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(name || ':' || active, ','), '-') FROM public.technicians
   WHERE user_id = pg_temp.uid(_email)
$$;

-- Turbine já tem uma vendedora "Carol" cadastrada pelo e-mail (convite com nome e comissão).
INSERT INTO public.salespeople (empresa_id, name, email, commission_percentage)
VALUES ('11111111-1111-1111-1111-111111111111', 'Carol', 'carol@equipe.test', 5);
SELECT count(*) AS antes FROM public.salespeople WHERE empresa_id = '11111111-1111-1111-1111-111111111111' \gset

-- 1. Entrou como atendente: liga a "Carol" pelo e-mail (não cria outra).
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
VALUES (pg_temp.uid('carol@equipe.test'), '11111111-1111-1111-1111-111111111111', 'atendente');
SELECT pg_temp.ok(pg_temp.vendedoras('carol@equipe.test') = 'Carol:true', 'liga pelo e-mail: ' || pg_temp.vendedoras('carol@equipe.test'));
SELECT pg_temp.ok((SELECT commission_percentage FROM public.salespeople WHERE user_id = pg_temp.uid('carol@equipe.test')) = 5,
  'mantém a comissão do convite');

-- 2. Atendente sem cadastro: cria a vendedora com o nome do perfil.
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
VALUES (pg_temp.uid('nova@equipe.test'), '11111111-1111-1111-1111-111111111111', 'atendente');
SELECT pg_temp.ok(pg_temp.vendedoras('nova@equipe.test') = 'Nova Silva:true', 'cria a vendedora: ' || pg_temp.vendedoras('nova@equipe.test'));
SELECT pg_temp.ok((SELECT count(*) FROM public.salespeople WHERE empresa_id = '11111111-1111-1111-1111-111111111111') = :antes + 1,
  'só uma vendedora nova');

-- 3. Técnico com o mesmo nome de um técnico sem login: liga em vez de duplicar.
INSERT INTO public.technicians (empresa_id, name, base_address)
VALUES ('11111111-1111-1111-1111-111111111111', 'Pedro Técnico', 'Rua X, 1');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
VALUES (pg_temp.uid('tec@equipe.test'), '11111111-1111-1111-1111-111111111111', 'tecnico');
SELECT pg_temp.ok(pg_temp.tecnicos('tec@equipe.test') = 'Pedro Técnico:true', 'liga pelo nome: ' || pg_temp.tecnicos('tec@equipe.test'));
SELECT pg_temp.ok((SELECT count(*) FROM public.technicians WHERE name = 'Pedro Técnico') = 1, 'sem técnico duplicado');

-- 4. Mudou de atendente para técnico: a vendedora fica inativa (não some) e o técnico é criado.
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
VALUES (pg_temp.uid('troca@equipe.test'), '11111111-1111-1111-1111-111111111111', 'atendente');
UPDATE public.usuarios_empresa SET papel = 'tecnico'
 WHERE user_id = pg_temp.uid('troca@equipe.test') AND empresa_id = '11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok(pg_temp.vendedoras('troca@equipe.test') = 'troca:false', 'vendedora desativada: ' || pg_temp.vendedoras('troca@equipe.test'));
SELECT pg_temp.ok(pg_temp.tecnicos('troca@equipe.test') = 'troca:true', 'técnico criado: ' || pg_temp.tecnicos('troca@equipe.test'));
-- 5. Voltou para atendente: reativa a mesma vendedora, desativa o técnico.
UPDATE public.usuarios_empresa SET papel = 'atendente'
 WHERE user_id = pg_temp.uid('troca@equipe.test') AND empresa_id = '11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok(pg_temp.vendedoras('troca@equipe.test') = 'troca:true', 'vendedora reativada: ' || pg_temp.vendedoras('troca@equipe.test'));
SELECT pg_temp.ok(pg_temp.tecnicos('troca@equipe.test') = 'troca:false', 'técnico desativado: ' || pg_temp.tecnicos('troca@equipe.test'));

-- 6. Admin não cria nada.
UPDATE public.usuarios_empresa SET papel = 'admin'
 WHERE user_id = pg_temp.uid('nova@equipe.test') AND empresa_id = '11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok(pg_temp.vendedoras('nova@equipe.test') = 'Nova Silva:false', 'admin: vendedora inativa');
SELECT pg_temp.ok(pg_temp.tecnicos('nova@equipe.test') = '-', 'admin: sem técnico');

ROLLBACK;
