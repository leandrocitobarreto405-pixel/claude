-- Alice no Claude Sonnet 5.5 (aprovado em 18/10/2026): metade do preço do Opus 5.5 na entrada e
-- na saída. O modelo continua configurável por empresa em Configurações › Alice (Ajustes avançados);
-- para voltar ao Opus, basta escolher lá (ou modelo = 'claude-opus-5-5').
ALTER TABLE public.ia_configuracoes ALTER COLUMN modelo SET DEFAULT 'claude-sonnet-5-5';
UPDATE public.ia_configuracoes SET modelo = 'claude-sonnet-5-5' WHERE modelo = 'claude-opus-5-5';
