-- Roteiro-base da Alice (migração 20261212120000): campos da empresa no roteiro e empresa nova
-- copiando o roteiro do Modelo Nexa, sempre desligada. Dados fictícios.
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

INSERT INTO auth.users (email) VALUES ('nexa680@nexa.test');
INSERT INTO public.plataforma_usuarios (user_id, papel)
SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa680@nexa.test';

-- Roteiro-base no modelo (em produção ele é criado a partir do roteiro da Turbine).
INSERT INTO public.ia_configuracoes (empresa_id, ativo, nome, instrucoes, perguntas_frequentes)
VALUES ('99999999-9999-4999-8999-999999999999', false, 'Alice',
        'Bem-vindo(a) à {nome_empresa}! Atendemos a {regiao_atendida}. Técnico com mais de {anos_experiencia} anos.',
        'P: Quem atende? R: {nomes_atendentes}.')
ON CONFLICT (empresa_id) DO UPDATE SET instrucoes = EXCLUDED.instrucoes, perguntas_frequentes = EXCLUDED.perguntas_frequentes;

SELECT pg_temp.ok((SELECT regiao_atendida = '' AND nomes_atendentes = '' AND anos_experiencia = ''
                     FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999'),
  'campos começam vazios');
SELECT pg_temp.deve_falhar($$UPDATE public.ia_configuracoes SET anos_experiencia = repeat('9', 11)
  WHERE empresa_id = '99999999-9999-4999-8999-999999999999'$$, 'anos de experiência longo demais');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'nexa680@nexa.test'), 'role', 'authenticated')::text, false);
SELECT set_config('request.headers', '{}', false);
SET ROLE authenticated;
CREATE TEMP TABLE nova680 AS SELECT public.provisionar_empresa('Empresa 680', NULL, NULL, NULL) AS id;
RESET ROLE;

SELECT pg_temp.ok((SELECT c.ativo = false AND c.instrucoes LIKE '%{regiao_atendida}%'
                          AND c.perguntas_frequentes LIKE '%{nomes_atendentes}%' AND c.regiao_atendida = ''
                     FROM public.ia_configuracoes c JOIN nova680 n ON n.id = c.empresa_id),
  'empresa nova copiou o roteiro-base, desligada e sem os campos');
SELECT pg_temp.ok((SELECT count(*) FROM public.config_options o JOIN nova680 n ON n.id = o.empresa_id) > 0,
  'continua copiando as listas do modelo');
ROLLBACK;
