-- Desfaz 20261228250000_enviada_por_chatwoot: tira o gatilho e as funções e limpa o enviada_por
-- que veio do Chatwoot (as mensagens enviadas pelo Nexa têm origem própria e não mudam).
DROP TRIGGER IF EXISTS trg_whatsapp_messages_enviada_por ON public.whatsapp_messages;
UPDATE public.whatsapp_messages SET enviada_por = NULL
 WHERE origem = 'chatwoot' AND direction = 'Enviada' AND enviada_por IS NOT NULL;
DROP FUNCTION IF EXISTS private.whatsapp_msg_enviada_por_chatwoot();
DROP FUNCTION IF EXISTS private.chatwoot_usuario_do_remetente(uuid, text);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228250000';
