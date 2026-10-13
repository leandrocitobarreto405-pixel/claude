-- OS criada sem lead: liga ao único lead aberto com o mesmo telefone; nenhum ou mais de um não
-- liga e fica registrado; OS que já tem lead não muda; OS com menos de 10 min espera. Fictício.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c3700000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Um', '(11) 97000-0001'),
  ('c3700000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Dois', '11 97000-0002'),
  ('c3700000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tres', '11970000003'),
  ('c3700000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Quatro', '11970000004');
-- Um: um lead aberto (salvo sem o 9). Dois: nenhum. Tres: dois abertos. Quatro: já tem lead ligado.
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open) VALUES
  ('a3700000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Um', '1170000001', '551170000001', true),
  ('a3700000-0000-0000-0000-000000000031', '11111111-1111-1111-1111-111111111111', 'Tres A', '11970000003', '5511970000003', true),
  ('a3700000-0000-0000-0000-000000000032', '11111111-1111-1111-1111-111111111111', 'Tres B', '11970000003', '5511970000003', true),
  ('a3700000-0000-0000-0000-000000000041', '11111111-1111-1111-1111-111111111111', 'Quatro', '11970000004', '5511970000004', true),
  ('a3700000-0000-0000-0000-000000000042', '11111111-1111-1111-1111-111111111111', 'Quatro outro', '11970000004', '5511970000004', true);
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, created_at) VALUES
  ('e3700000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '37001', 'c3700000-0000-0000-0000-000000000001', 249.90, now() - interval '20 minutes'),
  ('e3700000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '37002', 'c3700000-0000-0000-0000-000000000002', 100, now() - interval '20 minutes'),
  ('e3700000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '37003', 'c3700000-0000-0000-0000-000000000003', 100, now() - interval '20 minutes'),
  ('e3700000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '37004', 'c3700000-0000-0000-0000-000000000004', 100, now() - interval '20 minutes'),
  ('e3700000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '37005', 'c3700000-0000-0000-0000-000000000001', 100, now() - interval '2 minutes');
-- OS 37004 nasceu do lead "Quatro" (o app ligou).
SELECT private.converter_lead_em_os('a3700000-0000-0000-0000-000000000041', 'e3700000-0000-0000-0000-000000000004');

SELECT pg_temp.ok(
  (SELECT public.crm_ligar_os_sem_lead('11111111-1111-1111-1111-111111111111', now() - interval '1 day'))
    = '{"ligadas": 1, "sem_lead": 1, "varios_leads": 1}'::jsonb, 'um ligado, um sem lead, um com vários');

-- 1) Exatamente um lead aberto (9º dígito pela chave): liga, fecha e põe status de fechado.
SELECT pg_temp.ok((SELECT linked_work_order_id = 'e3700000-0000-0000-0000-000000000001' AND NOT is_open
                          AND os_criada_em IS NOT NULL
                          AND (SELECT (metadata->>'closed')::boolean AND NOT coalesce((metadata->>'lost')::boolean, false)
                                 FROM public.config_options WHERE id = status_id)
                     FROM public.crm_leads WHERE id = 'a3700000-0000-0000-0000-000000000001'),
  'lead único ligado e fechado');
SELECT pg_temp.ok((SELECT change_source FROM public.crm_status_history
                    WHERE crm_lead_id = 'a3700000-0000-0000-0000-000000000001') = 'Vínculo automático',
  'histórico diz que foi automático');
-- 2) Nenhum lead: não liga, registra.
SELECT pg_temp.ok((SELECT resultado FROM public.ads_eventos WHERE detalhe->>'os_number' = '37002') = 'os_sem_lead',
  'sem lead registrado');
-- 3) Dois leads abertos: não liga nenhum, registra.
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_leads WHERE id IN ('a3700000-0000-0000-0000-000000000031',
                     'a3700000-0000-0000-0000-000000000032') AND linked_work_order_id IS NULL AND is_open) = 2,
  'com dois leads, nenhum é ligado');
SELECT pg_temp.ok((SELECT resultado || ':' || (detalhe->>'leads_abertos') FROM public.ads_eventos
                    WHERE detalhe->>'os_number' = '37003') = 'os_varios_leads:2', 'vários leads registrado');
-- OS que já tem lead não muda (o outro lead aberto com o mesmo telefone continua aberto).
SELECT pg_temp.ok((SELECT is_open AND linked_work_order_id IS NULL FROM public.crm_leads
                    WHERE id = 'a3700000-0000-0000-0000-000000000042'), 'OS com lead não é mexida');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ads_eventos WHERE detalhe->>'os_number' IN ('37004', '37005')),
  'OS com lead e OS nova (menos de 10 min) ficam de fora');
-- Rodar de novo não repete nada.
SELECT pg_temp.ok(
  (SELECT public.crm_ligar_os_sem_lead('11111111-1111-1111-1111-111111111111', now() - interval '1 day'))
    = '{"ligadas": 0, "sem_lead": 0, "varios_leads": 0}'::jsonb, 'cada OS avaliada uma vez');
-- Só o servidor chama.
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.crm_ligar_os_sem_lead(uuid, timestamptz)', 'EXECUTE'),
  'tela não chama');

ROLLBACK;
