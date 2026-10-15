-- Origem certa: gclid/gbraid → Google (sem sobrescrever) e cópia da origem ao ligar lead e OS. Fictício.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'

CREATE FUNCTION pg_temp.origem(_nome text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.config_options WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
     AND kind = 'sales_origin' AND name = _nome
$$;
SELECT pg_temp.ok(pg_temp.origem('Google') IS NOT NULL AND pg_temp.origem('Indicação') IS NOT NULL,
                  'empresa de teste tem as origens Google e Indicação');

-- ---------------------------------------------------------------- 1) clique do Google
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, gclid) VALUES
  ('a4000000-0000-0000-0000-000000000001', :'E', 'Com gclid', '11971000001', '5511971000001', true, 'gclid-ficticio');
SELECT pg_temp.ok((SELECT sales_origin_id = pg_temp.origem('Google') AND origem_automatica
                     FROM public.crm_leads WHERE id = 'a4000000-0000-0000-0000-000000000001'),
                  'lead novo com gclid e sem origem vira Google automático');

INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open) VALUES
  ('a4000000-0000-0000-0000-000000000002', :'E', 'Gbraid depois', '11971000002', '5511971000002', true);
SELECT pg_temp.ok((SELECT sales_origin_id IS NULL FROM public.crm_leads WHERE id = 'a4000000-0000-0000-0000-000000000002'),
                  'sem clique, continua sem origem');
UPDATE public.crm_leads SET gbraid = 'gbraid-ficticio' WHERE id = 'a4000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((SELECT sales_origin_id = pg_temp.origem('Google') FROM public.crm_leads WHERE id = 'a4000000-0000-0000-0000-000000000002'),
                  'gbraid que chega depois (leitura da planilha) vira Google');

INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, gclid, sales_origin_id) VALUES
  ('a4000000-0000-0000-0000-000000000003', :'E', 'Indicação com gclid', '11971000003', '5511971000003', true, 'gclid-x', pg_temp.origem('Indicação'));
SELECT pg_temp.ok((SELECT sales_origin_id = pg_temp.origem('Indicação') AND NOT origem_automatica
                     FROM public.crm_leads WHERE id = 'a4000000-0000-0000-0000-000000000003'),
                  'origem já escolhida não é sobrescrita pelo clique');

-- Empresa sem a origem Google: nada muda e nada quebra.
INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Sem Google')
ON CONFLICT (id) DO NOTHING;
UPDATE public.config_options SET active = false
 WHERE empresa_id = '22222222-2222-2222-2222-222222222222' AND kind = 'sales_origin'
   AND (metadata->>'codigo' = 'google' OR lower(name) = 'google');
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, gclid) VALUES
  ('a4000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Outra empresa', '11971000004', '5511971000004', true, 'gclid-y');
SELECT pg_temp.ok((SELECT sales_origin_id IS NULL FROM public.crm_leads WHERE id = 'a4000000-0000-0000-0000-000000000004'),
                  'empresa sem origem Google ativa: lead fica sem origem');

-- ---------------------------------------------------------------- 2) copiar a origem ao ligar
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c4000000-0000-0000-0000-000000000001', :'E', 'Cliente A', '11971000005'),
  ('c4000000-0000-0000-0000-000000000002', :'E', 'Cliente B', '11971000006'),
  ('c4000000-0000-0000-0000-000000000003', :'E', 'Cliente C', '11971000007');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sales_origin_id) VALUES
  ('e4000000-0000-0000-0000-000000000001', :'E', '40001', 'c4000000-0000-0000-0000-000000000001', 100, pg_temp.origem('Google')),
  ('e4000000-0000-0000-0000-000000000002', :'E', '40002', 'c4000000-0000-0000-0000-000000000002', 100, NULL),
  ('e4000000-0000-0000-0000-000000000003', :'E', '40003', 'c4000000-0000-0000-0000-000000000003', 100, pg_temp.origem('Google'));
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, sales_origin_id) VALUES
  ('a4000000-0000-0000-0000-000000000005', :'E', 'Lead sem origem', '11971000005', '5511971000005', true, NULL),
  ('a4000000-0000-0000-0000-000000000006', :'E', 'Lead com origem', '11971000006', '5511971000006', true, pg_temp.origem('Indicação')),
  ('a4000000-0000-0000-0000-000000000007', :'E', 'Os dois com origem', '11971000007', '5511971000007', true, pg_temp.origem('Indicação'));

SELECT private.converter_lead_em_os('a4000000-0000-0000-0000-000000000005', 'e4000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok((SELECT sales_origin_id = pg_temp.origem('Google') AND origem_automatica AND NOT is_open
                          AND linked_work_order_id = 'e4000000-0000-0000-0000-000000000001'
                     FROM public.crm_leads WHERE id = 'a4000000-0000-0000-0000-000000000005'),
                  'lead sem origem recebe a origem da OS ao ser ligado');

SELECT private.converter_lead_em_os('a4000000-0000-0000-0000-000000000006', 'e4000000-0000-0000-0000-000000000002');
SELECT pg_temp.ok((SELECT sales_origin_id = pg_temp.origem('Indicação') FROM public.work_orders WHERE id = 'e4000000-0000-0000-0000-000000000002'),
                  'OS sem origem recebe a origem do lead ao ser ligada');

SELECT private.converter_lead_em_os('a4000000-0000-0000-0000-000000000007', 'e4000000-0000-0000-0000-000000000003');
SELECT pg_temp.ok((SELECT sales_origin_id = pg_temp.origem('Indicação') FROM public.crm_leads WHERE id = 'a4000000-0000-0000-0000-000000000007')
                  AND (SELECT sales_origin_id = pg_temp.origem('Google') FROM public.work_orders WHERE id = 'e4000000-0000-0000-0000-000000000003'),
                  'os dois com origem: nenhum lado muda');

-- O resto da conversão continua igual: status fechado, histórico e marco os_criada_em.
SELECT pg_temp.ok((SELECT os_criada_em IS NOT NULL AND (SELECT (metadata->>'closed')::boolean FROM public.config_options WHERE id = status_id)
                     FROM public.crm_leads WHERE id = 'a4000000-0000-0000-0000-000000000005'),
                  'conversão continua fechando o lead e marcando a OS criada');
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_status_history WHERE crm_lead_id = 'a4000000-0000-0000-0000-000000000005' AND change_source = 'Orçamento') = 1,
                  'histórico do status registrado');

ROLLBACK;
