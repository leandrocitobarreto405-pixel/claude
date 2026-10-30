-- Desempenho (30/10/2026), depois do travamento do banco por Disk IO. Só acrescenta índices e
-- reescreve duas políticas do jeito eficiente (mesma regra); nada é apagado.
-- 1. Varredura de áudios sem transcrição (roda a cada minuto): lia whatsapp_messages inteira.
--    Índice parcial só com as mensagens ainda sem transcrição (fica pequeno).
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sem_transcricao
  ON public.whatsapp_messages (empresa_id, message_timestamp DESC)
  WHERE transcricao IS NULL AND transcricao_erro IS NULL;

-- 2. Prévia da lista de Conversas (últimas mensagens de várias conversas, por created_at).
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversa_criada
  ON public.whatsapp_messages (conversa_id, created_at DESC);

-- 3. Políticas que recalculavam auth.uid() / realtime.topic() a cada linha (aviso do Advisor):
--    a mesma regra, com o valor calculado uma vez por consulta.
DO $$ BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    DROP POLICY IF EXISTS "tempo real da empresa" ON realtime.messages;
    CREATE POLICY "tempo real da empresa" ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND (SELECT realtime.topic()) ~ '^empresa:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND substring((SELECT realtime.topic()) FROM 9)::uuid IN (
          SELECT private.empresas_do_usuario((SELECT auth.uid())))
      );
  END IF;
END $$;

DROP POLICY IF EXISTS conversas_leituras_proprias ON public.conversas_leituras;
CREATE POLICY conversas_leituras_proprias ON public.conversas_leituras FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND empresa_id = (SELECT private.empresa_ativa()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND empresa_id = (SELECT private.empresa_ativa()));
