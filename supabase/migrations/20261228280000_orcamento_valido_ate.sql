-- Valor garantido do orçamento (28/10, serviço para data futura): até quando o valor vale. Vazio =
-- validade normal (dias da configuração). A Alice grava com garantir_valor_ate; a mensagem e o PDF
-- do orçamento mostram "Valor garantido até dd/mm".
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS valido_ate date;
