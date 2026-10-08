-- Orçamento: classe do estofado (A/B/C), acréscimos por item (almofadas soltas, muito encardido)
-- e o tipo do desconto (campanha, indicação ou valor manual). Tudo desligado por padrão; só
-- acrescenta colunas, nada existente muda nem é apagado.

-- 1. Regras da empresa: classe A com acréscimo e acréscimos por item. Classes B e C = tabela.
ALTER TABLE public.orcamento_configuracoes
  ADD COLUMN IF NOT EXISTS classe_ligada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classe_a_pct numeric(5,2) NOT NULL DEFAULT 20
    CHECK (classe_a_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS acrescimos_ligado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS almofadas_soltas_pct numeric(5,2) NOT NULL DEFAULT 10
    CHECK (almofadas_soltas_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS encardido_pct numeric(5,2) NOT NULL DEFAULT 10
    CHECK (encardido_pct BETWEEN 0 AND 100);

-- 2. Item do orçamento: classe escolhida, acréscimos marcados e o percentual somado aplicado
--    (para relatório). preco_tabela = tabela; preco_sugerido = com acréscimos (calculado);
--    preco_aplicado = final; editado_por/editado_em = quem mudou o valor final.
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS classe text CHECK (classe IN ('A', 'B', 'C')),
  ADD COLUMN IF NOT EXISTS almofadas_soltas boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS muito_encardido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acrescimo_pct numeric(5,2) NOT NULL DEFAULT 0;

-- 3. Desconto do orçamento: campanha OU indicação (percentual das regras de marketing, nunca os
--    dois) ou valor manual. Vazio = sem desconto (ou orçamento antigo).
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS desconto_tipo text
    CHECK (desconto_tipo IN ('campanha', 'indicacao', 'manual')),
  ADD COLUMN IF NOT EXISTS desconto_pct numeric(5,2)
    CHECK (desconto_pct IS NULL OR desconto_pct BETWEEN 0 AND 100);
