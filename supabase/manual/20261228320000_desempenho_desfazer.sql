-- Desfaz 20261228320000_desempenho (só com OK): tira os dois índices novos e volta as duas políticas
-- ao texto anterior (mesma regra).
DROP INDEX IF EXISTS public.idx_whatsapp_messages_sem_transcricao;
DROP INDEX IF EXISTS public.idx_whatsapp_messages_conversa_criada;
DO $$ BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    DROP POLICY IF EXISTS "tempo real da empresa" ON realtime.messages;
    CREATE POLICY "tempo real da empresa" ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND realtime.topic() ~ '^empresa:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND substring(realtime.topic() FROM 9)::uuid IN (SELECT private.empresas_do_usuario(auth.uid()))
      );
  END IF;
END $$;
DROP POLICY IF EXISTS conversas_leituras_proprias ON public.conversas_leituras;
CREATE POLICY conversas_leituras_proprias ON public.conversas_leituras FOR ALL TO authenticated
  USING (user_id = auth.uid() AND empresa_id = (SELECT private.empresa_ativa()))
  WITH CHECK (user_id = auth.uid() AND empresa_id = (SELECT private.empresa_ativa()));
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228320000';
