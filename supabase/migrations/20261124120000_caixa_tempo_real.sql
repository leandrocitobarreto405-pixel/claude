-- Caixa de entrada, item 2: tempo real. conversas e whatsapp_messages entram na publicação do
-- Realtime do Supabase; o RLS por empresa que já existe nas duas tabelas vale também aí (cada
-- navegador só recebe as linhas da própria empresa). REPLICA IDENTITY FULL para o Realtime
-- conferir as políticas também em UPDATE. Nenhum dado muda.
ALTER TABLE public.conversas REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'conversas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversas;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
END $$;
