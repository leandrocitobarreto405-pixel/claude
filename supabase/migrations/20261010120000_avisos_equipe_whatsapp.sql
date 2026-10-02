-- Avisos da equipe pelo WhatsApp (tela Avisos): cliente esperando a equipe e resumo do dia.
-- Tudo desligado por padrão. O envio continua sendo o de mkt_avisos (processarAvisosWhatsapp),
-- só para o telefone da equipe em mkt_configuracoes.aviso_telefone e só com
-- aviso_whatsapp_ligado. Nada aqui envia mensagem para cliente.

ALTER TABLE public.mkt_configuracoes
  -- Avisar quando um cliente esperar a equipe mais que N minutos (vazio = desligado).
  ADD COLUMN IF NOT EXISTS aviso_espera_minutos int,
  -- Resumo do dia às 9h (serviços de hoje, atrasados, sem técnico, conversas esperando).
  ADD COLUMN IF NOT EXISTS aviso_resumo_diario boolean NOT NULL DEFAULT false;

ALTER TABLE public.mkt_configuracoes
  ADD CONSTRAINT mkt_configuracoes_aviso_espera
  CHECK (aviso_espera_minutos IS NULL OR aviso_espera_minutos BETWEEN 5 AND 240);

-- Conversa do aviso de espera (para não avisar duas vezes a mesma espera).
ALTER TABLE public.mkt_avisos
  ADD COLUMN IF NOT EXISTS conversa_id uuid REFERENCES public.conversas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_mkt_avisos_conversa
  ON public.mkt_avisos (conversa_id, created_at DESC) WHERE conversa_id IS NOT NULL;

-- A conversa do aviso precisa ser da mesma empresa.
CREATE OR REPLACE TRIGGER trg_mkt_avisos_valida_empresa BEFORE INSERT OR UPDATE ON public.mkt_avisos
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'campanha_id', 'mkt_campanhas', 'lote_id', 'mkt_lotes', 'conversa_id', 'conversas');
