-- Caixa de entrada no app (aprovada em 20/10/2026), item 1: responder pelo Nexa OS. Só acréscimos.
--  * whatsapp_messages.enviada_por: quem respondeu pelo app (null = Chatwoot, Alice ou campanha).
--  * whatsapp_messages.erro_envio: erro curto do WhatsApp/Chatwoot quando o envio falha.
--  * conversas.assumida_por / assumida_em: quem assumiu a conversa no app (itens 3 e 4).
--  * conversas.lida_por: última leitura de cada pessoa no app (não lidas), {usuario: horário}.
-- Nenhum dado existente muda; o Chatwoot continua recebendo tudo pelo webhook de hoje.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS enviada_por uuid,
  ADD COLUMN IF NOT EXISTS erro_envio text;

ALTER TABLE public.conversas
  ADD COLUMN IF NOT EXISTS assumida_por uuid,
  ADD COLUMN IF NOT EXISTS assumida_em timestamptz,
  ADD COLUMN IF NOT EXISTS lida_por jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversa_hora
  ON public.whatsapp_messages (conversa_id, message_timestamp DESC);
