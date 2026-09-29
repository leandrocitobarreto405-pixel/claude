-- Alice: depois de mandar um vídeo ou áudio, o resto da resposta (ex.: o orçamento) espera alguns
-- minutos — o cliente vê o vídeo com calma e a mídia, que demora a carregar no WhatsApp, não chega
-- depois do orçamento. O resto vira uma tarefa "enviar_mensagens" na fila da Alice; se o cliente
-- escrever antes, ela é enviada na hora, antes da próxima resposta. Humano na conversa: não envia.
ALTER TABLE public.ia_configuracoes
  ADD COLUMN espera_apos_midia_segundos int NOT NULL DEFAULT 120
    CHECK (espera_apos_midia_segundos BETWEEN 0 AND 600);

ALTER TABLE public.ia_tarefas DROP CONSTRAINT ia_tarefas_tipo_check;
ALTER TABLE public.ia_tarefas ADD CONSTRAINT ia_tarefas_tipo_check
  CHECK (tipo IN ('responder', 'passar_para_humano', 'followup', 'enviar_mensagens'));
