-- Colunas do resumo do dia e dos lotes da Tatiana (migração 20261228510000; arquivo 1070). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set A '10700000-0000-4000-8000-00000000000a'
INSERT INTO public.empresas (id, nome) VALUES (:'A', 'Empresa Fictícia A 1070');
INSERT INTO public.crm_leads (id, empresa_id, lead_name) VALUES ('10700000-0000-4000-8000-0000000000b1', :'A', 'Lead Fictício 1070');

-- Ficha antiga continua válida sem as colunas novas; e aceita o resumo.
INSERT INTO public.comercial_analises (empresa_id, crm_lead_id, grupo, status, fatos)
VALUES (:'A', '10700000-0000-4000-8000-0000000000b1', 'outras', 'ok', '{}');
SELECT pg_temp.ok((SELECT resumo_dia IS NULL AND resumo_ate IS NULL AND leitura_completa_em IS NULL
                     FROM public.comercial_analises WHERE crm_lead_id = '10700000-0000-4000-8000-0000000000b1'),
  'colunas do resumo nascem vazias');
UPDATE public.comercial_analises
   SET resumo_dia = 'Pediu orçamento de sofá; achou caro; volta na sexta.', resumo_ate = now(), leitura_completa_em = now()
 WHERE crm_lead_id = '10700000-0000-4000-8000-0000000000b1';
DO $$ BEGIN
  UPDATE public.comercial_analises SET resumo_dia = repeat('x', 4001)
   WHERE crm_lead_id = '10700000-0000-4000-8000-0000000000b1';
  RAISE EXCEPTION 'FALHOU: resumo acima de 4000 caracteres aceito';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Noite sem lote continua válida; situação do lote só com os valores previstos.
INSERT INTO public.comercial_noites (id, empresa_id, noite, modo) VALUES ('10700000-0000-4000-8000-0000000000c1', :'A', '2026-11-12', 'ativo');
SELECT pg_temp.ok((SELECT lote_id IS NULL AND lote_situacao IS NULL AND lote_aplicados = 0
                     FROM public.comercial_noites WHERE id = '10700000-0000-4000-8000-0000000000c1'),
  'colunas do lote nascem vazias');
UPDATE public.comercial_noites SET lote_id = 'lote_ficticio_1', lote_situacao = 'enviado', lote_enviado_em = now()
 WHERE id = '10700000-0000-4000-8000-0000000000c1';
UPDATE public.comercial_noites SET lote_situacao = 'aplicado', lote_aplicados = 12 WHERE id = '10700000-0000-4000-8000-0000000000c1';
DO $$ BEGIN
  UPDATE public.comercial_noites SET lote_situacao = 'qualquer' WHERE id = '10700000-0000-4000-8000-0000000000c1';
  RAISE EXCEPTION 'FALHOU: situação de lote fora da lista aceita';
EXCEPTION WHEN check_violation THEN NULL; END $$;

ROLLBACK;
