-- Tatiana, gerente do mês, etapa 1 (migração 20261228380000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set E '97000000-0000-4000-8000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 970');
INSERT INTO auth.users (email) VALUES ('dona@p970.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'dona@p970.test';

-- O push de alerta de gerente é um tipo válido e só sai uma vez por chave.
INSERT INTO public.push_envios (empresa_id, user_id, tipo, ref, titulo)
SELECT :'E', id, 'alerta_gerente', 'dia_vazio:2026-11-04', 'Agenda vazia em 04/11' FROM auth.users WHERE email = 'dona@p970.test';
DO $$ BEGIN
  INSERT INTO public.push_envios (empresa_id, user_id, tipo, ref, titulo)
  SELECT '97000000-0000-4000-8000-00000000000e', id, 'alerta_gerente', 'dia_vazio:2026-11-04', 'de novo'
    FROM auth.users WHERE email = 'dona@p970.test';
  RAISE EXCEPTION 'FALHOU: repetiu o alerta da mesma chave';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;
DO $$ BEGIN
  INSERT INTO public.push_envios (empresa_id, user_id, tipo, ref, titulo)
  SELECT '97000000-0000-4000-8000-00000000000e', id, 'tipo_inventado', 'x', 'x'
    FROM auth.users WHERE email = 'dona@p970.test';
  RAISE EXCEPTION 'FALHOU: aceitou tipo de push inválido';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- Aviso de gerente no app: uma vez por referência (índice que já existe).
INSERT INTO public.mkt_avisos (empresa_id, tipo, titulo, mensagem, so_no_app, referencia)
VALUES (:'E', 'gerente_alerta', 'Tatiana: Sem meta cadastrada para o mês', 'Cadastre a meta.', true, 'gerente_alerta:sem_meta:2026-11');
DO $$ BEGIN
  INSERT INTO public.mkt_avisos (empresa_id, tipo, titulo, mensagem, so_no_app, referencia)
  VALUES ('97000000-0000-4000-8000-00000000000e', 'gerente_alerta', 'x', 'x', true, 'gerente_alerta:sem_meta:2026-11');
  RAISE EXCEPTION 'FALHOU: repetiu o aviso da mesma referência';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_avisos WHERE empresa_id = :'E') = 1, 'um aviso por referência');
ROLLBACK;
