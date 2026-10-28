-- 1ª resposta por pessoa (28/10): quem escreveu a mensagem no Chatwoot.
-- O webhook message_created traz, nas mensagens de saída digitadas no Chatwoot, o sender
-- (type "user", com o id do atendente). Ao gravar a mensagem, o id vira o usuário do Nexa pelo
-- mapeamento de Configurações › Equipe (usuarios_empresa.chatwoot_agent_id) e vai para
-- whatsapp_messages.enviada_por, o mesmo campo das mensagens enviadas pelo próprio Nexa.
-- Mensagem que chega como eco do celular (WhatsApp Business) não tem sender: fica "Equipe".
-- Envio do próprio Nexa: o Nexa grava depois o usuário certo por cima (caixa.functions.ts).
-- Também preenche as mensagens antigas que ainda têm o evento guardado.
CREATE OR REPLACE FUNCTION private.chatwoot_usuario_do_remetente(_empresa uuid, _evento text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.user_id
    FROM public.integracao_eventos e
    JOIN public.usuarios_empresa u
      ON u.empresa_id = _empresa
     AND u.chatwoot_agent_id::text = e.payload->'sender'->>'id'
   WHERE e.id::text = _evento
     AND e.empresa_id = _empresa
     AND lower(e.payload->'sender'->>'type') = 'user'
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.chatwoot_usuario_do_remetente(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.whatsapp_msg_enviada_por_chatwoot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.enviada_por := private.chatwoot_usuario_do_remetente(NEW.empresa_id, NEW.raw_event_reference);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.whatsapp_msg_enviada_por_chatwoot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_messages_enviada_por ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_enviada_por
  BEFORE INSERT ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (NEW.origem = 'chatwoot' AND NEW.direction = 'Enviada' AND NOT coalesce(NEW.privada, false)
        AND NEW.enviada_por IS NULL AND NEW.raw_event_reference IS NOT NULL)
  EXECUTE FUNCTION private.whatsapp_msg_enviada_por_chatwoot();

-- Mensagens antigas com o evento ainda guardado.
UPDATE public.whatsapp_messages m
   SET enviada_por = private.chatwoot_usuario_do_remetente(m.empresa_id, m.raw_event_reference)
 WHERE m.origem = 'chatwoot' AND m.direction = 'Enviada' AND NOT m.privada AND m.enviada_por IS NULL
   AND m.raw_event_reference IS NOT NULL
   AND private.chatwoot_usuario_do_remetente(m.empresa_id, m.raw_event_reference) IS NOT NULL;
