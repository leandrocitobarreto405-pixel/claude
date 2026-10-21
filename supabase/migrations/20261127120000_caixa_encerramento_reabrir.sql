-- Encerramento automático de conversas paradas (Configurações › Mensagens): quem estava com a
-- conversa quando ela foi encerrada, para a reabertura voltar para a pessoa certa.
--
-- 1. conversas.encerrada_de ('alice' = estava pending, 'equipe' = estava open) e encerrada_em,
--    preenchidos pelo app ao encerrar (automático, em lote ou uma a uma). Só acrescenta colunas.
-- 2. Mensagem do cliente numa conversa encerrada que estava com a Alice: entra uma tarefa
--    "devolver_para_alice" (o motor da Alice muda para pending no Chatwoot e responde se o
--    cliente está esperando). Se estava com a equipe, o Chatwoot já reabre como open (aba da
--    equipe); só a marca é limpa. Nada é enviado ao cliente por este gatilho.
ALTER TABLE public.conversas
  ADD COLUMN IF NOT EXISTS encerrada_de text CHECK (encerrada_de IN ('alice', 'equipe')),
  ADD COLUMN IF NOT EXISTS encerrada_em timestamptz;

CREATE OR REPLACE FUNCTION private.reabrir_conversa_encerrada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'Recebida' OR NEW.conversa_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id, empresa_id, encerrada_de INTO c
    FROM public.conversas
   WHERE id = NEW.conversa_id AND encerrada_de IS NOT NULL;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  UPDATE public.conversas SET encerrada_de = NULL, encerrada_em = NULL WHERE id = c.id;
  IF c.encerrada_de = 'alice' THEN
    INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo, motivo)
    VALUES (c.empresa_id, c.id, 'devolver_para_alice',
            'cliente escreveu depois do encerramento: a conversa volta para a Alice')
    ON CONFLICT (conversa_id, tipo) WHERE situacao = 'pendente' DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.reabrir_conversa_encerrada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_messages_reabrir ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_reabrir AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION private.reabrir_conversa_encerrada();
