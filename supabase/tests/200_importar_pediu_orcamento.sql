-- Importação: coluna "Pediu orçamento" (Sim → Orçamento sem agendamento; Não ou vazio → Conversou).
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.listas(_fone text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(array_to_string(familias, ','), '-') FROM private.mkt_publico('11111111-1111-1111-1111-111111111111',
    '{"orcamento": {}, "conversa": {}, "clientes": {}}', false)
   WHERE telefone = _fone
$$;

CREATE TEMP TABLE imp AS SELECT public.mkt_importar_contatos('11111111-1111-1111-1111-111111111111', jsonb_build_array(
  jsonb_build_object('telefone', '11930000001', 'nome', 'Sim Orc', 'tipo', 'nao_comprador',
    'entrada_em', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - 40, 'YYYY-MM-DD'), 'pediu_orcamento', true),
  jsonb_build_object('telefone', '11930000002', 'nome', 'Nao Orc', 'tipo', 'nao_comprador',
    'entrada_em', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - 40, 'YYYY-MM-DD'), 'pediu_orcamento', false),
  jsonb_build_object('telefone', '11930000003', 'nome', 'Vazio Orc', 'tipo', 'nao_comprador',
    'entrada_em', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - 40, 'YYYY-MM-DD'))
), 'teste') AS r;

SELECT pg_temp.ok((SELECT (r->>'com_orcamento')::int = 1 AND (r->>'novos')::int = 3 FROM imp),
  'importação: ' || (SELECT r::text FROM imp));
SELECT pg_temp.ok(pg_temp.listas('5511930000001') = 'orcamento', 'Sim → orçamento: ' || pg_temp.listas('5511930000001'));
SELECT pg_temp.ok(pg_temp.listas('5511930000002') = 'conversa', 'Não → conversa: ' || pg_temp.listas('5511930000002'));
SELECT pg_temp.ok(pg_temp.listas('5511930000003') = 'conversa', 'vazio → conversa: ' || pg_temp.listas('5511930000003'));
SELECT pg_temp.ok((SELECT dias_orcamento FROM private.mkt_publico('11111111-1111-1111-1111-111111111111',
                     '{"orcamento": {}}', false) WHERE telefone = '5511930000001') = 40, 'orçamento há 40 dias (faixa até 90)');

-- Não sobrescreve uma data de orçamento mais recente; atualiza uma mais antiga.
UPDATE public.mkt_contatos SET orcamento_em = now() - interval '5 days' WHERE normalized_phone = '5511930000001';
SELECT public.mkt_importar_contatos('11111111-1111-1111-1111-111111111111', jsonb_build_array(
  jsonb_build_object('telefone', '11930000001', 'tipo', 'nao_comprador',
    'entrada_em', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - 40, 'YYYY-MM-DD'), 'pediu_orcamento', 'Sim')), 'teste');
SELECT pg_temp.ok((SELECT orcamento_em > now() - interval '6 days' FROM public.mkt_contatos
                    WHERE normalized_phone = '5511930000001'), 'não sobrescreve data mais recente');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_contatos
                    WHERE private.telefone_chave(normalized_phone) = private.telefone_chave('5511930000001')) = 1,
  'sem duplicar o contato');
ROLLBACK;
