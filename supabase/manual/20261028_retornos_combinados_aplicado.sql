-- GRAVADO MANUALMENTE PELO SQL EDITOR em 28/10/2026 às 13h37 (não rodar de novo). Conferido:
-- 7374 e 9327 em trilha C com a Alice (28/11) e 1969 em trilha C com a Alice (16/11).
-- Retornos combinados pelo modelo fu_retorno_combinado (28/10): 7374 e 9327 (28/11) deixam a
-- retomada fu_retomada_horarios e viram retorno combinado (trilha C); 1969 (16/11), que estava só
-- como tarefa da equipe, passa para a Alice. Pode rodar mais de uma vez (não duplica).
BEGIN;
UPDATE public.ia_tarefas
   SET dados = jsonb_build_object('trilha', 'C', 'motivo', 'Adiou: retorno combinado em 30 dias',
         'mensagem_sugerida', 'Empatia primeiro: pergunte como estão as coisas, citando o que o cliente contou. Só depois que ele responder, retome o orçamento e ofereça dois horários reais da agenda.'),
       motivo = 'Adiou: retorno combinado em 30 dias'
 WHERE id IN ('779e44c5-f389-4fa0-bbba-647321b90964', 'c73c2b8d-1a9d-46e2-924e-aeaa3678c456')
   AND empresa_id = '11111111-1111-1111-1111-111111111111' AND situacao = 'pendente';
UPDATE public.crm_followups
   SET etapa = NULL, trilha = 'C',
       notes = '🤖 Retorno combinado (trilha C, adiou 30 dias): fora da janela vai o modelo fu_retorno_combinado; quando o cliente responder, empatia primeiro e depois o orçamento.'
 WHERE id IN ('aadb80e5-e5a5-4b54-b997-af92917263b6', 'b246fffa-6c72-47c7-a408-d8e1ca926f57')
   AND empresa_id = '11111111-1111-1111-1111-111111111111' AND status = 'Pendente';
WITH nova AS (
  INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo, executar_apos, motivo, dados)
  SELECT '11111111-1111-1111-1111-111111111111', f.conversa_id, 'followup', f.scheduled_at,
         'Retorno combinado: depois da obra no imóvel (após 15/11)',
         jsonb_build_object('trilha', 'C', 'motivo', 'Retorno combinado: depois da obra no imóvel (após 15/11)',
           'mensagem_sugerida', 'Primeiro a obra: "Oi, [nome]! Deu tudo certo com a obra aí no imóvel? Ficou do jeito que você queria? 😊". Depois que ele responder: "Que bom! Quando quiser, a gente já agenda a higienização pra deixar tudo novinho."')
    FROM public.crm_followups f
   WHERE f.id = 'b43ead2e-e5b2-4ee8-901d-1d423847e319' AND f.status = 'Pendente' AND f.ia_tarefa_id IS NULL
  RETURNING id)
UPDATE public.crm_followups
   SET responsavel = 'alice', ia_tarefa_id = (SELECT id FROM nova),
       notes = '🤖 Retorno combinado (trilha C): depois da obra no imóvel. Fora da janela vai o modelo fu_retorno_combinado; quando o cliente responder, primeiro a obra, depois o serviço.'
 WHERE id = 'b43ead2e-e5b2-4ee8-901d-1d423847e319' AND status = 'Pendente' AND EXISTS (SELECT 1 FROM nova);
COMMIT;

-- Conferência (deve mostrar trilha C nos três):
SELECT f.trilha, f.etapa, f.responsavel, f.ia_tarefa_id IS NOT NULL tem_tarefa, f.scheduled_at
  FROM public.crm_followups f
 WHERE f.id IN ('aadb80e5-e5a5-4b54-b997-af92917263b6', 'b246fffa-6c72-47c7-a408-d8e1ca926f57', 'b43ead2e-e5b2-4ee8-901d-1d423847e319');
