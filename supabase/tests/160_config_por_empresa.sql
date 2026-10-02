-- Configuração por empresa: modelos por finalidade (Turbine com tc_, empresa nova neutra), dias de
-- disparo, nome da empresa fora do "primeiro nome" e empresa nova sem as taxas da empresa-modelo.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO public.empresas (id, nome) VALUES ('33333333-3333-3333-3333-333333333333', 'Lava Bem Estofados');
INSERT INTO public.mkt_configuracoes (empresa_id, modelos)
VALUES ('11111111-1111-1111-1111-111111111111', jsonb_build_object('posvenda', 'tc_posvenda_resultado',
          'oferta', 'tc_oferta_trimestral', 'sazonal_prefixo', 'tc_sazonal_'))
ON CONFLICT (empresa_id) DO UPDATE SET modelos = EXCLUDED.modelos;

-- 1. Modelos por finalidade.
SELECT pg_temp.ok(private.mkt_modelo('11111111-1111-1111-1111-111111111111', 'posvenda') = 'tc_posvenda_resultado', 'Turbine: tc_');
SELECT pg_temp.ok(private.mkt_modelo('33333333-3333-3333-3333-333333333333', 'posvenda') = 'posvenda_resultado', 'nova: neutro');
SELECT pg_temp.ok(private.mkt_template_padrao('11111111-1111-1111-1111-111111111111', 'C4', '2026-11-01') = 'tc_oferta_trimestral', 'C4 Turbine');
SELECT pg_temp.ok(private.mkt_template_padrao('33333333-3333-3333-3333-333333333333', 'N2', '2026-11-01') = 'sazonal_nov', 'sazonal nova');
SELECT pg_temp.ok(private.mkt_template_padrao('11111111-1111-1111-1111-111111111111', 'N2', '2026-12-01') = 'tc_sazonal_dez', 'sazonal Turbine');
SELECT pg_temp.ok(private.mkt_template_padrao('C4', '2026-11-01') = 'tc_oferta_trimestral', 'versão antiga continua');
-- Gatilho da empresa nova nasce com o modelo neutro.
SELECT private.mkt_campanha_gatilho('33333333-3333-3333-3333-333333333333', 'C1', '2026-11-01');
SELECT pg_temp.ok((SELECT template_nome FROM public.mkt_campanhas
                    WHERE empresa_id = '33333333-3333-3333-3333-333333333333' AND gatilho = 'C1') = 'posvenda_resultado',
  'gatilho C1 neutro');

-- 2. Dias de disparo: padrão terça a quinta; segunda e sexta quando configurado.
SELECT pg_temp.ok(private.mkt_proximo_dia_util('2026-10-03', '{2,3,4}') = '2026-10-06', 'sábado → terça');
SELECT pg_temp.ok(private.mkt_proximo_dia_util('2026-10-03', '{1,5}') = '2026-10-05', 'sábado → segunda');
SELECT pg_temp.ok((SELECT dias_disparo FROM public.mkt_configuracoes
                    WHERE empresa_id = '11111111-1111-1111-1111-111111111111') = '{2,3,4}', 'padrão terça a quinta');
DO $$ BEGIN
  UPDATE public.mkt_configuracoes SET dias_disparo = '{0}' WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION 'FALHOU: aceitou dia inválido';
EXCEPTION WHEN check_violation THEN NULL; END $$;
UPDATE public.mkt_configuracoes SET dias_disparo = '{1,5}' WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok(extract(isodow FROM private.mkt_proximo_horario('11111111-1111-1111-1111-111111111111',
                    '2026-10-06 12:00-03')) = 5, 'terça → próximo disparo na sexta');

-- 3. Nome da empresa não é primeiro nome de cliente.
INSERT INTO public.mkt_contatos (empresa_id, nome, normalized_phone, tipo) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Lava Bem', '5511977771111', 'nao_comprador'),
  ('33333333-3333-3333-3333-333333333333', 'Carla Lava', '5511977771112', 'nao_comprador');
SELECT pg_temp.ok((SELECT primeiro_nome FROM public.mkt_contatos WHERE normalized_phone = '5511977771111') IS NULL,
  'nome da empresa descartado');
SELECT pg_temp.ok((SELECT primeiro_nome FROM public.mkt_contatos WHERE normalized_phone = '5511977771112') = 'Carla',
  'nome de cliente normal');

-- 4. Empresa nova não copia taxas nem margens da empresa-modelo.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000f9', 'nexa@config.dev');
INSERT INTO public.plataforma_usuarios (user_id, papel) VALUES ('00000000-0000-0000-0000-0000000000f9', 'nexa_admin');
INSERT INTO public.configuracoes_plataforma (chave, valor)
VALUES ('empresa_modelo_id', '"11111111-1111-1111-1111-111111111111"')
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO public.payment_rates (empresa_id, channel, payment_type, installments, rate_percent, active)
VALUES ('11111111-1111-1111-1111-111111111111', 'Maquininha', 'Crédito', 1, 3.5, true);
INSERT INTO public.app_settings (empresa_id, key, value) VALUES
  ('11111111-1111-1111-1111-111111111111', 'tax_percent', '6'),
  ('11111111-1111-1111-1111-111111111111', 'message_template', '"Olá"')
ON CONFLICT (empresa_id, key) DO UPDATE SET value = EXCLUDED.value;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f9","role":"authenticated"}', true);
SELECT private.provisionar_empresa('Empresa Teste Config', NULL, NULL, 4) AS nova \gset
SELECT pg_temp.ok((SELECT count(*) FROM public.payment_rates WHERE empresa_id = :'nova') = 0, 'sem taxas copiadas');
SELECT pg_temp.ok((SELECT count(*) FROM public.app_settings WHERE empresa_id = :'nova' AND key = 'tax_percent') = 0,
  'sem imposto copiado');
SELECT pg_temp.ok((SELECT count(*) FROM public.app_settings WHERE empresa_id = :'nova' AND key = 'message_template') = 1,
  'texto genérico copiado');

ROLLBACK;
