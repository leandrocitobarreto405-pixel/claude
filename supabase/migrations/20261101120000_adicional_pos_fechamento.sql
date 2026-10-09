-- Adicional pós-fechamento: item oferecido depois que o cliente confirma o serviço (ex.: colchão
-- num pedido só de higienização), com preço próprio e marcado para relatório. Só acrescenta
-- colunas; nada existente muda nem é apagado.

-- 1. Preço do item como adicional (higienização). Vazio = o item não é oferecido como adicional.
ALTER TABLE public.tabela_precos_itens
  ADD COLUMN IF NOT EXISTS preco_adicional numeric(10,2)
    CHECK (preco_adicional IS NULL OR preco_adicional > 0);

-- 2. Item incluído como adicional pós-fechamento: preço fixo, fora do desconto de campanha e de
--    indicação (o Pix vale sobre o total).
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS adicional_pos_fechamento boolean NOT NULL DEFAULT false;
ALTER TABLE public.service_items
  ADD COLUMN IF NOT EXISTS adicional_pos_fechamento boolean NOT NULL DEFAULT false;

-- 3. Oferta no orçamento: quando foi feita e a resposta (vazio = ainda sem resposta). Uma vez só.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS adicional_oferecido_em timestamptz,
  ADD COLUMN IF NOT EXISTS adicional_aceito boolean;
