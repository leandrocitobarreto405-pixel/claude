-- Taxas (tabela pronta) e padrões de empresa nova (migração 20261228240000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

SELECT pg_temp.ok((SELECT count(*) FROM private.tabela_taxas('infinitepay')) = 31, 'InfinitePay com 31 linhas');
SELECT pg_temp.ok((SELECT count(*) FROM private.tabela_taxas('santander')) = 0, 'Santander ainda sem tabela');
SELECT pg_temp.ok((SELECT rate_percent FROM private.tabela_taxas('infinitepay')
                    WHERE channel = 'Link de pagamento' AND installments = 12) = 16.66, 'link 12x 16,66%');

-- Empresa nova (pela Nexa) já vem com os padrões.
INSERT INTO auth.users (email) VALUES ('nexa900@nexa.test');
INSERT INTO public.plataforma_usuarios (user_id, papel)
SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa900@nexa.test';
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'nexa900@nexa.test'), 'role', 'authenticated')::text, true);
CREATE TEMP TABLE nova AS SELECT private.provisionar_empresa('Empresa Fictícia 900') AS id;
SELECT pg_temp.ok((SELECT count(*) FROM public.payment_rates r, nova WHERE r.empresa_id = nova.id) = 31, 'taxas InfinitePay');
SELECT pg_temp.ok((SELECT pix_pct = 5 AND arredondamento = 'nenhum' AND NOT vitrine_ligada
                     FROM public.orcamento_configuracoes o, nova WHERE o.empresa_id = nova.id), 'Pix 5%, sem arredondamento, boas-vindas desligado');
SELECT pg_temp.ok((SELECT dias_antes_preparo = 5 AND preparo_automatico AND NOT aviso_whatsapp_ligado
                     FROM public.mkt_configuracoes m, nova WHERE m.empresa_id = nova.id), 'marketing 5 dias antes, aviso desligado');
SELECT pg_temp.ok((SELECT value #>> '{}' FROM public.app_settings a, nova WHERE a.empresa_id = nova.id AND a.key = 'invoice_rule') = 'sempre', 'nota sempre');
SELECT pg_temp.ok((SELECT value #>> '{}' FROM public.app_settings a, nova WHERE a.empresa_id = nova.id AND a.key = 'taxas_maquininha') = 'infinitepay', 'maquininha InfinitePay');

-- Empresa que já existe: a tabela só entra pelo botão do admin e não duplica.
\set E '90000000-0000-4000-8000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 900b');
INSERT INTO public.payment_rates (empresa_id, channel, payment_type, installments, rate_percent)
VALUES (:'E', 'Maquininha', 'Débito', 1, 1.99), (:'E', 'Boleto', 'Boleto', 1, 3);
DO $$ BEGIN
  INSERT INTO public.payment_rates (empresa_id, channel, payment_type, installments, rate_percent)
  VALUES ('90000000-0000-4000-8000-00000000000e', 'Maquininha', 'Débito', 1, 5);
  RAISE EXCEPTION 'FALHOU: taxa repetida passou';
EXCEPTION WHEN unique_violation THEN NULL; END $$;
INSERT INTO auth.users (id, email) VALUES ('90000000-0000-4000-8000-0000000000a1', 'admin900@teste.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES ('90000000-0000-4000-8000-0000000000a1', :'E', 'admin');
SELECT set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT set_config('app.empresa_ativa', :'E', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.aplicar_tabela_taxas('infinitepay') = 31, 'aplicou 31 taxas');
SELECT pg_temp.ok(public.aplicar_tabela_taxas('infinitepay') = 31, 'aplicar de novo atualiza, não duplica');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.payment_rates WHERE empresa_id = :'E') = 32, '31 da tabela + o boleto que já existia');
SELECT pg_temp.ok((SELECT rate_percent FROM public.payment_rates WHERE empresa_id = :'E' AND payment_type = 'Débito') = 2.58, 'débito trocado pela tabela');

-- Arredondamento aceita "nenhum"; valor estranho não.
UPDATE public.orcamento_configuracoes o SET arredondamento = 'nenhum' FROM nova WHERE o.empresa_id = nova.id;
DO $$ BEGIN
  UPDATE public.orcamento_configuracoes SET arredondamento = 'centena';
  RAISE EXCEPTION 'FALHOU: arredondamento inválido passou';
EXCEPTION WHEN check_violation THEN NULL; END $$;
ROLLBACK;
