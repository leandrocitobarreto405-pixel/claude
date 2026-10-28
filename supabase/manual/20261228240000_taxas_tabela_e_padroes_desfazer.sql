-- Desfaz 20261228240000_taxas_tabela_e_padroes. As taxas já gravadas (inclusive as que vieram da
-- tabela pronta) ficam; só sai o que a migração criou. Antes, tire do código o botão da tabela e a
-- opção "Sem arredondamento" (empresa com "nenhum" voltaria a falhar na restrição).
BEGIN;
DROP FUNCTION IF EXISTS public.aplicar_tabela_taxas(text);
UPDATE public.orcamento_configuracoes SET arredondamento = 'dezena_5' WHERE arredondamento = 'nenhum';
ALTER TABLE public.orcamento_configuracoes DROP CONSTRAINT IF EXISTS orcamento_configuracoes_arredondamento_check;
ALTER TABLE public.orcamento_configuracoes ADD CONSTRAINT orcamento_configuracoes_arredondamento_check
  CHECK (arredondamento IN ('dezena_5', 'noventa'));
ALTER TABLE public.orcamento_configuracoes ALTER COLUMN pix_pct SET DEFAULT 10;
ALTER TABLE public.orcamento_configuracoes ALTER COLUMN arredondamento SET DEFAULT 'dezena_5';
ALTER TABLE public.mkt_configuracoes ALTER COLUMN dias_antes_preparo SET DEFAULT 10;
-- private.provisionar_empresa: rode de novo o CREATE OR REPLACE da versão anterior (está no
-- banco antes desta migração; o texto está em 20261228240000 sem o bloco "Padrões de empresa nova").
DROP FUNCTION IF EXISTS private.tabela_taxas(text);
DROP INDEX IF EXISTS public.payment_rates_empresa_combinacao_key;
COMMIT;
