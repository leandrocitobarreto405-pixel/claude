-- Tapete (cobrado por m²) e persiana (por peça): categorias novas na tabela de preços e
-- quantidade com casas decimais no orçamento e na OS (ex.: 1,6 × 2,3 = 3,68 m²). Nada é apagado:
-- a quantidade dos itens que já existem continua igual (inteiro vira o mesmo número).

-- 1. Categorias novas (as regras de item adicional / desconto do 2º item não valem para elas).
ALTER TABLE public.tabela_precos_itens DROP CONSTRAINT IF EXISTS tabela_precos_itens_categoria_check;
ALTER TABLE public.tabela_precos_itens ADD CONSTRAINT tabela_precos_itens_categoria_check
  CHECK (categoria IN ('sofa', 'colchao', 'cadeira', 'outro', 'tapete', 'persiana'));

-- 2. Quantidade com até 2 casas decimais (m²). Itens por peça continuam inteiros pelo app.
ALTER TABLE public.quote_items ALTER COLUMN quantidade TYPE numeric(10,2);
ALTER TABLE public.service_items ALTER COLUMN quantity TYPE numeric(10,2);

-- 3. Unidade do item da OS (para mostrar "m²" na OS, no documento e na tela do técnico).
ALTER TABLE public.service_items
  ADD COLUMN IF NOT EXISTS unidade text NOT NULL DEFAULT 'un' CHECK (unidade IN ('un', 'm2'));
