-- Gerente comercial, fase 1 (migração 20261228290000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, false);
$$;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set E '93000000-0000-4000-8000-00000000000e'
\set F '93000000-0000-4000-8000-00000000000f'
\set L1 '93000000-0000-4000-8000-0000000000a1'
\set L2 '93000000-0000-4000-8000-0000000000a2'
\set L3 '93000000-0000-4000-8000-0000000000a3'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 930'), (:'F', 'Outra Fictícia 930');
SELECT private.garantir_motivos_sem_desfecho(:'E');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.config_options WHERE empresa_id = :'E' AND name = 'Agenda cheia / sem manhã livre')
                  AND NOT EXISTS (SELECT 1 FROM public.config_options WHERE empresa_id = :'E' AND name = 'Agenda cheia'),
                  'empresa nova já ganha o nome novo');
INSERT INTO auth.users (email) VALUES ('dona@p930.test'), ('atendente@p930.test'), ('dona@f930.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'dona@p930.test'
UNION ALL SELECT id, :'E'::uuid, 'atendente'::papel_empresa FROM auth.users WHERE email = 'atendente@p930.test'
UNION ALL SELECT id, :'F'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'dona@f930.test';
INSERT INTO public.config_options (empresa_id, kind, name, display_order, metadata)
VALUES (:'E', 'crm_status', 'Desistiu', 9, '{"lost": true}');
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, first_contact_date, orcamento_enviado_em) VALUES
  (:'L1', :'E', 'Lead Fictício 1', '11993000001', '5511993000001', current_date - 5, now() - interval '5 days'),
  (:'L2', :'E', 'Lead Fictício 2', '11993000002', '5511993000002', current_date - 5, now() - interval '5 days'),
  (:'L3', :'E', 'Lead Fictício 3', '11993000003', '5511993000003', current_date - 5, now() - interval '5 days');
INSERT INTO public.comercial_analises (empresa_id, crm_lead_id, grupo, status, resultado, motivo_sugerido_id) VALUES
  (:'E', :'L1', 'google', 'ok', 'sem_desfecho', (SELECT id FROM public.config_options WHERE empresa_id = :'E' AND name = 'Só cotando')),
  (:'E', :'L2', 'google', 'ok', 'sem_desfecho', (SELECT id FROM public.config_options WHERE empresa_id = :'E' AND name = 'Só cotando')),
  (:'E', :'L3', 'outras', 'ok', 'sem_desfecho', (SELECT id FROM public.config_options WHERE empresa_id = :'E' AND name = 'Fora da área'));

-- Atendente não vê as fichas; outra empresa também não; o admin vê.
SELECT pg_temp.como('atendente@p930.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_analises) = 0, 'atendente não vê');
RESET ROLE;
SELECT pg_temp.como('dona@f930.test', :'F');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_analises) = 0, 'outra empresa não vê');
RESET ROLE;
SELECT pg_temp.como('dona@p930.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_analises) = 3, 'admin vê as 3');
-- Ninguém grava direto na tabela pelo app.
DO $$ BEGIN
  UPDATE public.comercial_analises SET nota = 10;
  RAISE EXCEPTION 'FALHOU: gravou direto';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- L1: confirma o motivo sugerido; L2: troca o motivo; L3: ainda não perdeu.
SELECT public.comercial_confirmar_perda((SELECT id FROM public.comercial_analises WHERE crm_lead_id = :'L1'),
  (SELECT id FROM public.config_options WHERE empresa_id = :'E' AND name = 'Só cotando'));
SELECT public.comercial_confirmar_perda((SELECT id FROM public.comercial_analises WHERE crm_lead_id = :'L2'),
  (SELECT id FROM public.config_options WHERE empresa_id = :'E' AND name = 'Agenda cheia / sem manhã livre'), 'queria de manhã');
SELECT public.comercial_nao_perdeu((SELECT id FROM public.comercial_analises WHERE crm_lead_id = :'L3'));
SELECT public.marcar_encaixe(:'L2', true, 'só sábado de manhã');
RESET ROLE;
SELECT pg_temp.ok((SELECT perda_situacao = 'confirmada' AND perda_por IS NOT NULL FROM public.comercial_analises WHERE crm_lead_id = :'L1'), 'L1 confirmada, com quem confirmou');
SELECT pg_temp.ok((SELECT perda_situacao = 'trocada' FROM public.comercial_analises WHERE crm_lead_id = :'L2'), 'L2 trocou o motivo');
SELECT pg_temp.ok((SELECT perdido_em IS NOT NULL AND desfecho_por IS NOT NULL FROM public.crm_leads WHERE id = :'L1'), 'L1 perdido pelo clique');
SELECT pg_temp.ok((SELECT perdido_em IS NULL AND is_open FROM public.crm_leads WHERE id = :'L3'), 'L3 segue aberto');
SELECT pg_temp.ok((SELECT perda_situacao = 'nao_perdeu' FROM public.comercial_analises WHERE crm_lead_id = :'L3'), 'L3 marcada "ainda não perdeu"');
SELECT pg_temp.ok((SELECT encaixe_pedido_em IS NOT NULL AND encaixe_obs = 'só sábado de manhã' FROM public.crm_leads WHERE id = :'L2'), 'pediu encaixe');
-- Responder de novo não vale.
SELECT pg_temp.como('dona@p930.test', :'E');
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.comercial_nao_perdeu((SELECT id FROM public.comercial_analises WHERE crm_lead_id = '93000000-0000-4000-8000-0000000000a1'));
  RAISE EXCEPTION 'FALHOU: respondeu duas vezes';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
END $$;
RESET ROLE;
-- Atendente não confirma perda.
SELECT pg_temp.como('atendente@p930.test', :'E');
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.comercial_nao_perdeu(gen_random_uuid());
  RAISE EXCEPTION 'FALHOU: atendente respondeu';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
ROLLBACK;
