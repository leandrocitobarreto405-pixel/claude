-- Caixa de entrada, item 2b: tempo real por empresa (broadcast do banco).
--
-- Por que: o Realtime "postgres_changes" aplica o RLS sem o cabeçalho x-empresa-id, então
-- private.empresa_ativa() devolve NULL para quem tem mais de uma empresa (ex.: quem cuida da
-- Turbine e da Ecoprime) e essa pessoa não recebe evento nenhum. Em vez disso, um gatilho em
-- conversas e whatsapp_messages manda um aviso curto no canal privado "empresa:<id>", e a
-- política em realtime.messages deixa cada pessoa ouvir só os canais das empresas dela.
-- Nenhum dado muda. Para voltar: apagar os dois gatilhos, a função e a política.

CREATE OR REPLACE FUNCTION private.avisar_tempo_real()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Em jsonb porque o gatilho serve a duas tabelas: NEW.conversa_id não existe em conversas e
  -- quebraria a gravação (aconteceu em 21/10: o webhook do Chatwoot parou de gravar).
  linha jsonb := to_jsonb(NEW);
  conversa text;
BEGIN
  -- Nunca derruba a gravação: qualquer erro aqui vira só um aviso no log.
  BEGIN
    conversa := CASE WHEN TG_TABLE_NAME = 'whatsapp_messages' THEN linha->>'conversa_id' ELSE linha->>'id' END;
    -- Fora do Supabase (testes locais) não existe realtime.send: segue sem avisar.
    IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
      PERFORM realtime.send(
        jsonb_build_object('tabela', TG_TABLE_NAME, 'conversa_id', conversa),
        'mudou',
        'empresa:' || (linha->>'empresa_id'),
        true
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'avisar_tempo_real: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION private.avisar_tempo_real() FROM PUBLIC;

DROP TRIGGER IF EXISTS tempo_real_whatsapp_messages ON public.whatsapp_messages;
CREATE TRIGGER tempo_real_whatsapp_messages
  AFTER INSERT OR UPDATE ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION private.avisar_tempo_real();

DROP TRIGGER IF EXISTS tempo_real_conversas ON public.conversas;
CREATE TRIGGER tempo_real_conversas
  AFTER INSERT OR UPDATE ON public.conversas
  FOR EACH ROW EXECUTE FUNCTION private.avisar_tempo_real();

-- Quem pode ouvir "empresa:<id>": quem está em usuarios_empresa dessa empresa (ou admin da Nexa).
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
