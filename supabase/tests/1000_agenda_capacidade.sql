-- Agenda real (migração 20261228410000): colunas da capacidade. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set E '99000000-0000-4000-8000-00000000001b'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 1000');
INSERT INTO public.agenda_configuracoes (empresa_id) VALUES (:'E');
SELECT pg_temp.ok((SELECT dia_inteiro_valor FROM public.agenda_configuracoes WHERE empresa_id = :'E') = 1000, 'dia inteiro nasce em R$ 1.000');
UPDATE public.agenda_configuracoes SET dia_inteiro_valor = 0 WHERE empresa_id = :'E';
SELECT pg_temp.ok((SELECT dia_inteiro_valor FROM public.agenda_configuracoes WHERE empresa_id = :'E') = 0, '0 desliga a regra do valor');
DO $$ BEGIN
  UPDATE public.agenda_configuracoes SET dia_inteiro_valor = -1 WHERE empresa_id = '99000000-0000-4000-8000-00000000001b';
  RAISE EXCEPTION 'FALHOU: valor negativo entrou';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- visits.ocupa_dia: nasce nulo (automático) e aceita true/false.
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'visits' AND column_name = 'ocupa_dia' AND is_nullable = 'YES'), 'visits.ocupa_dia existe e aceita nulo');
ROLLBACK;
