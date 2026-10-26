-- Alice: o que fazer quando nem o cliente nem a foto dizem o tecido (por empresa).
-- 'equipe' = passa para a equipe com o motivo "confirmar tecido" (como hoje, padrão do Modelo Nexa);
-- 'A', 'B' ou 'C' = segue o orçamento com essa classe, sem falar de classe com o cliente.
ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS tecido_nao_identificado text NOT NULL DEFAULT 'equipe'
    CHECK (tecido_nao_identificado IN ('equipe', 'A', 'B', 'C'));
COMMENT ON COLUMN public.ia_configuracoes.tecido_nao_identificado IS
  'Tecido não identificado (cliente não sabe e a foto não deixa claro): equipe (transfere) ou a classe usada no orçamento';
