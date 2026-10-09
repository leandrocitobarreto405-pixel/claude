-- Adicional pós-fechamento: campos neutros em itens e orçamentos antigos, preço só positivo.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO public.tabela_precos_itens (empresa_id, nome, preco_higienizacao, categoria, preco_adicional)
VALUES ('11111111-1111-1111-1111-111111111111', 'Colchão casal teste', 249.90, 'colchao', 199.90),
       ('11111111-1111-1111-1111-111111111111', 'Sofá teste', 310, 'sofa', NULL);
SELECT pg_temp.ok((SELECT preco_adicional FROM public.tabela_precos_itens WHERE nome = 'Colchão casal teste') = 199.90,
  'preço de adicional gravado');
SELECT pg_temp.ok((SELECT preco_adicional IS NULL FROM public.tabela_precos_itens WHERE nome = 'Sofá teste'),
  'item sem adicional');
DO $$
BEGIN
  UPDATE public.tabela_precos_itens SET preco_adicional = 0 WHERE nome = 'Sofá teste';
  RAISE EXCEPTION 'FALHOU: aceitou adicional zero';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

INSERT INTO public.quotes (empresa_id, cliente_nome, subtotal, desconto, total)
VALUES ('11111111-1111-1111-1111-111111111111', 'Adicional', 310, 0, 310);
INSERT INTO public.quote_items (empresa_id, quote_id, nome_snapshot, tipo_servico, preco_tabela, preco_aplicado, subtotal)
SELECT '11111111-1111-1111-1111-111111111111', id, 'Sofá', 'higienizacao', 310, 310, 310 FROM public.quotes WHERE cliente_nome = 'Adicional';
SELECT pg_temp.ok((SELECT NOT adicional_pos_fechamento FROM public.quote_items WHERE nome_snapshot = 'Sofá'), 'item antigo não é adicional');
SELECT pg_temp.ok((SELECT adicional_oferecido_em IS NULL AND adicional_aceito IS NULL FROM public.quotes WHERE cliente_nome = 'Adicional'),
  'orçamento antigo sem oferta');
SELECT pg_temp.ok((SELECT count(*) FROM public.service_items WHERE adicional_pos_fechamento) = 0, 'itens de OS antigos não são adicionais');

ROLLBACK;
