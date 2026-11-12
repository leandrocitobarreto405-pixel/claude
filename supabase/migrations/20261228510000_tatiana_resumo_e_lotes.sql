-- Tatiana: resumo do dia e lotes da noite — 12/11, custo aprovado pelo dono. Só colunas novas, todas
-- vazias por padrão: nada é apagado nem alterado no que já existe e, sem o código novo, o
-- comportamento continua igual.
--
-- Resumo do dia (comercial_analises): a noite guarda um resumo curto de cada lead e até que
-- mensagem ele cobre. Nas noites seguintes ela lê só o resumo e o que chegou depois dele, em vez da
-- conversa inteira; uma vez por semana relê tudo (leitura_completa_em).
ALTER TABLE public.comercial_analises
  ADD COLUMN IF NOT EXISTS resumo_dia text,
  ADD COLUMN IF NOT EXISTS resumo_ate timestamptz,
  ADD COLUMN IF NOT EXISTS leitura_completa_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comercial_analises_resumo_dia_tamanho') THEN
    ALTER TABLE public.comercial_analises
      ADD CONSTRAINT comercial_analises_resumo_dia_tamanho
      CHECK (resumo_dia IS NULL OR length(resumo_dia) <= 4000);
  END IF;
END $$;

COMMENT ON COLUMN public.comercial_analises.resumo_dia IS 'Resumo curto do lead escrito pela Tatiana na última leitura (base da leitura só do que mudou).';
COMMENT ON COLUMN public.comercial_analises.resumo_ate IS 'Até que mensagem (data e hora) o resumo_dia cobre.';
COMMENT ON COLUMN public.comercial_analises.leitura_completa_em IS 'Última vez que a Tatiana releu a conversa inteira do lead (releitura semanal).';

-- Lotes (comercial_noites): a noite manda as leituras num lote (metade do preço) e aplica as
-- decisões quando o lote volta. Se o lote não voltar a tempo, a noite segue pelo caminho direto.
ALTER TABLE public.comercial_noites
  ADD COLUMN IF NOT EXISTS lote_id text,
  ADD COLUMN IF NOT EXISTS lote_situacao text,
  ADD COLUMN IF NOT EXISTS lote_enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS lote_aplicados integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comercial_noites_lote_situacao_check') THEN
    ALTER TABLE public.comercial_noites
      ADD CONSTRAINT comercial_noites_lote_situacao_check
      CHECK (lote_situacao IS NULL OR lote_situacao IN ('enviado', 'pronto', 'aplicado', 'direto', 'falhou'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comercial_noites_lote_id_tamanho') THEN
    ALTER TABLE public.comercial_noites
      ADD CONSTRAINT comercial_noites_lote_id_tamanho CHECK (lote_id IS NULL OR length(lote_id) <= 120);
  END IF;
END $$;

COMMENT ON COLUMN public.comercial_noites.lote_id IS 'Identificador do lote de leituras da noite na conta de IA.';
COMMENT ON COLUMN public.comercial_noites.lote_situacao IS 'enviado (esperando), pronto (voltou), aplicado (decisões gravadas), direto (seguiu sem lote), falhou.';
COMMENT ON COLUMN public.comercial_noites.lote_enviado_em IS 'Quando o lote da noite foi enviado.';
COMMENT ON COLUMN public.comercial_noites.lote_aplicados IS 'Quantas decisões do lote já foram aplicadas.';
