-- Alice: Claude Opus 5.5 passa a ser o modelo padrão (mesma qualidade, preço menor que o Opus 5).
-- Claude Sonnet 5 dá lugar ao Sonnet 5.5 (o Sonnet 5 não aceita mensagem de sistema no meio da
-- conversa, usada para manter o histórico no cache).
ALTER TABLE public.ia_configuracoes ALTER COLUMN modelo SET DEFAULT 'claude-opus-5-5';
UPDATE public.ia_configuracoes SET modelo = 'claude-opus-5-5' WHERE modelo = 'claude-opus-5';
UPDATE public.ia_configuracoes SET modelo = 'claude-sonnet-5-5' WHERE modelo = 'claude-sonnet-5';
