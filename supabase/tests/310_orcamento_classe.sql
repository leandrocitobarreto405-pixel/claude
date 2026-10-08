-- Orçamento: classe do estofado, acréscimos por item e tipo do desconto. Desligado por padrão,
-- só o admin liga; itens e orçamentos antigos ficam neutros; valores fora da regra são recusados.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'admin@classe.dev'),
  ('00000000-0000-0000-0000-0000000000f2', 'atendente@classe.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111', 'atendente');

-- Admin liga classe e acréscimos; o resto continua desligado.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.orcamento_configuracoes (empresa_id, classe_ligada, acrescimos_ligado)
VALUES ('11111111-1111-1111-1111-111111111111', true, true);
RESET ROLE;
SELECT pg_temp.ok((SELECT classe_a_pct = 20 AND almofadas_soltas_pct = 10 AND encardido_pct = 10
                     AND NOT desconto_adicional_ligado AND NOT vitrine_ligada AND NOT sujidade_ligado
                     FROM public.orcamento_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111'),
  'padrões: A +20%, almofadas +10%, encardido +10%, resto desligado');

-- Atendente lê, mas não muda os percentuais.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.orcamento_configuracoes SET classe_a_pct = 50;
RESET ROLE;
SELECT pg_temp.ok((SELECT classe_a_pct FROM public.orcamento_configuracoes) = 20, 'atendente não altera a classe A');

-- Empresa sem linha: tudo desligado (a Ecoprime de teste não ganha regra nenhuma).
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.orcamento_configuracoes
                               WHERE empresa_id <> '11111111-1111-1111-1111-111111111111' AND classe_ligada),
  'outras empresas sem classe');

-- Itens e orçamentos antigos: neutros.
INSERT INTO public.quotes (empresa_id, cliente_nome, subtotal, desconto, total)
VALUES ('11111111-1111-1111-1111-111111111111', 'Classe', 100, 0, 100);
INSERT INTO public.quote_items (empresa_id, quote_id, nome_snapshot, tipo_servico, preco_tabela, preco_aplicado, subtotal)
SELECT '11111111-1111-1111-1111-111111111111', id, 'Sofá', 'higienizacao', 100, 100, 100 FROM public.quotes WHERE cliente_nome = 'Classe';
SELECT pg_temp.ok((SELECT classe IS NULL AND NOT almofadas_soltas AND NOT muito_encardido AND acrescimo_pct = 0
                     FROM public.quote_items WHERE nome_snapshot = 'Sofá'), 'item antigo neutro');
SELECT pg_temp.ok((SELECT desconto_tipo IS NULL AND desconto_pct IS NULL FROM public.quotes WHERE cliente_nome = 'Classe'),
  'orçamento antigo sem tipo de desconto');

-- Valores fora da regra são recusados.
DO $$
BEGIN
  UPDATE public.quote_items SET classe = 'D' WHERE nome_snapshot = 'Sofá';
  RAISE EXCEPTION 'FALHOU: aceitou classe D';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
DO $$
BEGIN
  UPDATE public.quotes SET desconto_tipo = 'os_dois' WHERE cliente_nome = 'Classe';
  RAISE EXCEPTION 'FALHOU: aceitou tipo de desconto inválido';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
UPDATE public.quote_items SET classe = 'A', almofadas_soltas = true, muito_encardido = true, acrescimo_pct = 40
 WHERE nome_snapshot = 'Sofá';
SELECT pg_temp.ok((SELECT acrescimo_pct FROM public.quote_items WHERE nome_snapshot = 'Sofá') = 40, 'classe A + acréscimos gravados');

ROLLBACK;
