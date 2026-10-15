-- Script único (14/10/2026, aprovado), Turbine: retornos pendentes da equipe em que a equipe já
-- respondeu na conversa depois de criados (ou cujo lead já virou OS / foi encerrado) ficam
-- resolvidos. Daqui em diante os gatilhos de 20261109120001 fazem isso sozinhos.
-- Contagem conferida antes: 18 pendentes, 16 a resolver (1 deles também com OS/encerrado).
WITH alvo AS (
  SELECT f.id, f.crm_lead_id,
         CASE WHEN l.linked_work_order_id IS NOT NULL THEN 'Lead virou OS'
              WHEN NOT l.is_open THEN 'Lead encerrado'
              ELSE 'Equipe respondeu na conversa' END AS motivo
    FROM public.crm_followups f
    JOIN public.crm_leads l ON l.id = f.crm_lead_id
   WHERE f.empresa_id = '11111111-1111-1111-1111-111111111111'
     AND f.status = 'Pendente' AND f.responsavel = 'equipe'
     AND (l.linked_work_order_id IS NOT NULL OR NOT l.is_open
          OR EXISTS (SELECT 1 FROM public.whatsapp_messages m
                      WHERE m.crm_lead_id = f.crm_lead_id AND m.direction = 'Enviada'
                        AND m.remetente_tipo = 'user' AND NOT m.privada
                        AND m.message_timestamp > f.created_at))
), feito AS (
  UPDATE public.crm_followups f
     SET status = 'Concluída', completed_at = now(), result = a.motivo,
         notes = coalesce(f.notes || E'\n', '') || 'Resolvido em 14/10/2026 pela correção dos retornos.'
    FROM alvo a
   WHERE f.id = a.id
  RETURNING f.crm_lead_id, a.motivo
), leads AS (
  UPDATE public.crm_leads l
     SET next_follow_up_at = (SELECT min(scheduled_at) FROM public.crm_followups
                               WHERE crm_lead_id = l.id AND status = 'Pendente')
   WHERE l.id IN (SELECT DISTINCT crm_lead_id FROM feito)
  RETURNING l.id
)
SELECT motivo, count(*) FROM feito GROUP BY motivo;
