-- Configuração da empresa (implantação): liberação só pela Nexa, Alice e envios travados enquanto
-- a empresa não é liberada, e as marcações "Revisei" / "Não se aplica" isoladas por empresa.
BEGIN;

CREATE FUNCTION pg_temp.como(_email text, _empresa uuid DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           CASE WHEN _email IS NULL THEN ''
                ELSE json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text END,
           false),
         set_config('request.headers',
           CASE WHEN _empresa IS NULL THEN '{}' ELSE json_build_object('x-empresa-id', _empresa)::text END,
           false);
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

INSERT INTO auth.users (email) VALUES ('nexa@nexa.test'), ('dono@lava.test'), ('dono@turbine.test');
INSERT INTO public.plataforma_usuarios (user_id, papel) SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa@nexa.test';
INSERT INTO public.empresas (id, nome) VALUES ('33333333-3333-3333-3333-333333333333', 'Lava Bem Estofados');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, '33333333-3333-3333-3333-333333333333', 'admin' FROM auth.users WHERE email = 'dono@lava.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, '11111111-1111-1111-1111-111111111111', 'admin' FROM auth.users WHERE email = 'dono@turbine.test';

-- 1. Quem já existia entra liberado; empresa nova não.
SELECT pg_temp.ok(private.empresa_liberada('11111111-1111-1111-1111-111111111111'), 'Turbine liberada');
SELECT pg_temp.ok(NOT private.empresa_liberada('33333333-3333-3333-3333-333333333333'), 'empresa nova não liberada');

-- 2. Empresa não liberada: Alice e envios a clientes não ligam (desligado pode).
SELECT pg_temp.deve_falhar($$INSERT INTO public.ia_configuracoes (empresa_id, ativo)
  VALUES ('33333333-3333-3333-3333-333333333333', true)$$, 'Alice ligada sem liberação');
INSERT INTO public.ia_configuracoes (empresa_id, ativo) VALUES ('33333333-3333-3333-3333-333333333333', false);
SELECT pg_temp.deve_falhar($$UPDATE public.ia_configuracoes SET ativo = true
  WHERE empresa_id = '33333333-3333-3333-3333-333333333333'$$, 'ligar a Alice sem liberação');
INSERT INTO public.mkt_configuracoes (empresa_id) VALUES ('33333333-3333-3333-3333-333333333333');
SELECT pg_temp.deve_falhar($$UPDATE public.mkt_configuracoes SET disparo_ligado = true
  WHERE empresa_id = '33333333-3333-3333-3333-333333333333'$$, 'envio ligado sem liberação');
SELECT pg_temp.deve_falhar($$UPDATE public.mkt_configuracoes SET gatilho_c1_ligado = true
  WHERE empresa_id = '33333333-3333-3333-3333-333333333333'$$, 'pós-venda ligado sem liberação');
UPDATE public.mkt_configuracoes SET hora_disparo = 11 WHERE empresa_id = '33333333-3333-3333-3333-333333333333';
SELECT pg_temp.ok(true, 'outras mudanças na configuração continuam');

-- 3. O dono da empresa não se libera sozinho; a Nexa libera.
SELECT pg_temp.como('dono@lava.test', '33333333-3333-3333-3333-333333333333');
SET ROLE authenticated;
SELECT pg_temp.deve_falhar($$UPDATE public.empresas SET implantacao_liberada_em = now()
  WHERE id = '33333333-3333-3333-3333-333333333333'$$, 'dono muda a liberação direto');
SELECT pg_temp.deve_falhar($$SELECT public.liberar_empresa('33333333-3333-3333-3333-333333333333', true)$$,
  'dono chama liberar_empresa');
UPDATE public.empresas SET telefone = '11999990000' WHERE id = '33333333-3333-3333-3333-333333333333';
-- "Revisei" e "Não se aplica" da própria empresa.
INSERT INTO public.implantacao_etapas (empresa_id, etapa, situacao)
VALUES ('33333333-3333-3333-3333-333333333333', 'taxas', 'revisado');
INSERT INTO public.implantacao_etapas (empresa_id, etapa, situacao)
VALUES ('33333333-3333-3333-3333-333333333333', 'veiculos', 'nao_se_aplica')
ON CONFLICT (empresa_id, etapa) DO UPDATE SET situacao = EXCLUDED.situacao;
UPDATE public.implantacao_etapas SET situacao = 'pendente' WHERE etapa = 'veiculos';
SELECT pg_temp.ok((SELECT count(*) FROM public.implantacao_etapas) = 2, 'vê só as da empresa ativa');
SELECT pg_temp.deve_falhar($$INSERT INTO public.implantacao_etapas (empresa_id, etapa, situacao)
  VALUES ('11111111-1111-1111-1111-111111111111', 'taxas', 'revisado')$$, 'marca etapa de outra empresa');
SELECT pg_temp.deve_falhar($$DELETE FROM public.implantacao_etapas WHERE true$$, 'apagar marcação');
RESET ROLE;
SELECT pg_temp.ok((SELECT telefone FROM public.empresas WHERE id = '33333333-3333-3333-3333-333333333333') = '11999990000',
  'dono continua alterando os dados da empresa');
SELECT pg_temp.ok((SELECT marcado_por FROM public.implantacao_etapas WHERE etapa = 'taxas')
  = (SELECT id FROM auth.users WHERE email = 'dono@lava.test'), 'guarda quem marcou');

-- Empresa criada pelo app (authenticated) nasce não liberada mesmo se tentar mandar a data.
SELECT pg_temp.como('nexa@nexa.test');
SET ROLE authenticated;
SELECT set_config('teste.nova', public.provisionar_empresa('Outra Estofados', NULL, NULL, NULL)::text, false);
RESET ROLE;
SELECT pg_temp.ok(NOT private.empresa_liberada(current_setting('teste.nova')::uuid), 'provisionada não liberada');

-- 4. Nexa libera: aí a Alice liga. Bloquear de novo desliga a Alice e os envios.
SELECT pg_temp.como('nexa@nexa.test', '33333333-3333-3333-3333-333333333333');
SET ROLE authenticated;
SELECT pg_temp.ok(public.liberar_empresa('33333333-3333-3333-3333-333333333333', true) IS NOT NULL, 'Nexa libera');
RESET ROLE;
SELECT pg_temp.ok((SELECT implantacao_liberada_por FROM public.empresas WHERE id = '33333333-3333-3333-3333-333333333333')
  = (SELECT id FROM auth.users WHERE email = 'nexa@nexa.test'), 'guarda quem liberou');
UPDATE public.ia_configuracoes SET ativo = true WHERE empresa_id = '33333333-3333-3333-3333-333333333333';
UPDATE public.mkt_configuracoes SET disparo_ligado = true, gatilho_c1_ligado = true
 WHERE empresa_id = '33333333-3333-3333-3333-333333333333';
SET ROLE authenticated;
SELECT public.liberar_empresa('33333333-3333-3333-3333-333333333333', false);
RESET ROLE;
SELECT pg_temp.ok(NOT private.empresa_liberada('33333333-3333-3333-3333-333333333333'), 'bloqueada de novo');
SELECT pg_temp.ok(NOT (SELECT ativo FROM public.ia_configuracoes WHERE empresa_id = '33333333-3333-3333-3333-333333333333'),
  'bloquear desliga a Alice');
SELECT pg_temp.ok(NOT (SELECT disparo_ligado OR gatilho_c1_ligado FROM public.mkt_configuracoes
                        WHERE empresa_id = '33333333-3333-3333-3333-333333333333'), 'bloquear desliga os envios');

-- 5. Cidade e estado: a Turbine é São Paulo/SP; estado só sigla válida.
SELECT pg_temp.ok((SELECT cidade || '/' || estado FROM public.empresas
                    WHERE id = '11111111-1111-1111-1111-111111111111') = 'São Paulo/SP', 'Turbine em São Paulo/SP');
SELECT pg_temp.deve_falhar($$UPDATE public.empresas SET estado = 'XX'
  WHERE id = '33333333-3333-3333-3333-333333333333'$$, 'estado inválido');
SELECT pg_temp.como('dono@lava.test', '33333333-3333-3333-3333-333333333333');
SET ROLE authenticated;
UPDATE public.empresas SET cidade = 'Cuiabá', estado = 'MT' WHERE id = '33333333-3333-3333-3333-333333333333';
RESET ROLE;
SELECT pg_temp.ok((SELECT estado FROM public.empresas WHERE id = '33333333-3333-3333-3333-333333333333') = 'MT',
  'dono preenche cidade e estado');

ROLLBACK;
