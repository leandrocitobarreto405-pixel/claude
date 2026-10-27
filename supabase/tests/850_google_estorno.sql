-- Estorno no Google (migração 20261228170000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ads_conversoes_google' AND column_name = 'estorno_horario'), 'coluna estorno_horario');
\set E '85000000-0000-4000-8000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 850');
INSERT INTO public.customers (id, empresa_id, full_name, phone)
VALUES ('85000000-0000-4000-8000-000000000101', :'E', 'Cliente Fictício 850', '11985000001');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, status, total_gross_value)
VALUES ('85000000-0000-4000-8000-000000000201', :'E', '8501', '85000000-0000-4000-8000-000000000101', 'Cancelada', 300);
INSERT INTO public.ads_conversoes_google (empresa_id, work_order_id, gclid, conversao_nome, conversao_horario, valor, base, exportada_em, retirada_em, estorno_horario)
VALUES (:'E', '85000000-0000-4000-8000-000000000201', 'gclid-teste-850', 'Venda Higienização', '2026-10-20 10:00:00-03:00', 300, 'clique', now(), now(), '2026-10-27 13:00:00-03:00');
SELECT pg_temp.ok((SELECT estorno_horario FROM public.ads_conversoes_google WHERE empresa_id = :'E') = '2026-10-27 13:00:00-03:00', 'grava o horário do estorno');
DO $$ BEGIN
  UPDATE public.ads_conversoes_google SET estorno_horario = '27/10/2026' WHERE gclid = 'gclid-teste-850';
  RAISE EXCEPTION 'FALHOU: formato do horário não foi conferido';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
ROLLBACK;
