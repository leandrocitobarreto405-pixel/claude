-- Colchão dupla face (26/10/2026): a higienização de colchão inclui a face de cima e as laterais;
-- quem usa os dois lados paga a dupla face. Acréscimo por empresa nas regras de orçamento
-- (desligado por padrão, 20% sugerido) e a marca no item do orçamento. Na OS, a marca fica na
-- descrição do item ("Colchão queen – dupla face (2 faces + laterais)"). Só acrescenta colunas.
ALTER TABLE public.orcamento_configuracoes
  ADD COLUMN IF NOT EXISTS dupla_face_ligada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dupla_face_pct numeric(5,2) NOT NULL DEFAULT 20
    CHECK (dupla_face_pct BETWEEN 0 AND 100);

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS dupla_face boolean NOT NULL DEFAULT false;
