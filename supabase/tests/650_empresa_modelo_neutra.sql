-- Empresa-modelo neutra (migração 20261209120000): empresa nova copia o modelo (inativo), não a
-- Turbine; origens com "Site (orgânico)" e "Blog" sem palavras de cupom; nada com "Turbine".
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

SELECT pg_temp.ok((SELECT valor #>> '{}' FROM public.configuracoes_plataforma WHERE chave = 'empresa_modelo_id')
                  = '99999999-9999-4999-8999-999999999999', 'modelo aponta para o neutro');
SELECT pg_temp.ok((SELECT NOT ativo FROM public.empresas WHERE id = '99999999-9999-4999-8999-999999999999'),
  'modelo inativo (não abre para ninguém)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.usuarios_empresa WHERE empresa_id = '99999999-9999-4999-8999-999999999999'),
  'modelo sem usuários');

INSERT INTO auth.users (email) VALUES ('nexa650@nexa.test');
INSERT INTO public.plataforma_usuarios (user_id, papel)
SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa650@nexa.test';
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'nexa650@nexa.test'), 'role', 'authenticated')::text, true);
CREATE TEMP TABLE nova AS SELECT private.provisionar_empresa('Empresa Fictícia 650') AS id;

SELECT pg_temp.ok((SELECT count(*) FROM public.config_options o, nova WHERE o.empresa_id = nova.id)
                  = (SELECT count(*) FROM public.config_options WHERE empresa_id = '99999999-9999-4999-8999-999999999999'),
  'copiou todo o catálogo do modelo');
SELECT pg_temp.ok((SELECT count(*) FROM public.config_options o, nova
                    WHERE o.empresa_id = nova.id AND o.kind = 'sales_origin' AND o.name IN ('Site (orgânico)', 'Blog')) = 2,
  'origens Site (orgânico) e Blog');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.config_options o, nova
                               WHERE o.empresa_id = nova.id AND o.metadata::text ILIKE '%cupom%'),
  'sem palavras de cupom da Turbine');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.app_settings a, nova
                               WHERE a.empresa_id = nova.id AND a.value::text ILIKE '%turbine%'),
  'mensagens sem Turbine');
SELECT pg_temp.ok((SELECT value::text LIKE '%INSTRUCAO_PAGAMENTO%' FROM public.app_settings a, nova
                    WHERE a.empresa_id = nova.id AND a.key = 'message_template'), 'mensagem de confirmação padrão');
SELECT pg_temp.ok((SELECT count(*) FROM public.config_options o, nova
                    WHERE o.empresa_id = nova.id AND o.kind = 'crm_status' AND o.metadata ? 'stage') = 10,
  'etapas do CRM com a etapa do funil');
ROLLBACK;
