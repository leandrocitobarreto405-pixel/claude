-- Motivo da falha na transcrição do áudio (para diagnosticar sem depender dos logs do Cloud Run).
ALTER TABLE public.whatsapp_messages ADD COLUMN transcricao_erro text;
