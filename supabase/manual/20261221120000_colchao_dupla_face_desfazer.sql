-- Desfaz 20261221120000_colchao_dupla_face sem apagar nada: desliga a dupla face em todas as
-- empresas (as colunas ficam; orçamentos e OS já feitos com dupla face continuam como estão).
UPDATE public.orcamento_configuracoes SET dupla_face_ligada = false WHERE dupla_face_ligada;
