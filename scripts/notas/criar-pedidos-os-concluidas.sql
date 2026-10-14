-- Script único (fase 2), Turbine: cria o pedido de nota (invoice_tasks, Pendente) das OS já
-- concluídas que se encaixam na regra "se o cliente tem CPF ou CNPJ" e ainda não têm pedido.
-- Valor = total da OS; data do serviço = última conclusão. Não cria para OS de teste.
-- SÓ RODAR DEPOIS DO OK DO DONO, com a lista conferida. Idempotente (não duplica).
-- Para ver antes, sem gravar: rode só o SELECT de "alvo".
WITH alvo AS (
  SELECT o.id, o.os_number, o.customer_id, c.document_number, o.total_gross_value,
         (SELECT max(v.completion_date) FROM public.visits v WHERE v.work_order_id = o.id AND v.status = 'Concluído') AS concluida_em
    FROM public.work_orders o JOIN public.customers c ON c.id = o.customer_id
   WHERE o.empresa_id = '11111111-1111-1111-1111-111111111111'
     AND o.deleted_at IS NULL AND NOT o.eh_teste AND o.status = 'Concluída'
     AND length(regexp_replace(coalesce(c.document_number, ''), '\D', '', 'g')) IN (11, 14)
     AND NOT EXISTS (SELECT 1 FROM public.invoice_tasks t WHERE t.work_order_id = o.id)
), criado AS (
  INSERT INTO public.invoice_tasks (empresa_id, work_order_id, customer_id, document_number, service_date, invoice_amount, status)
  SELECT '11111111-1111-1111-1111-111111111111', a.id, a.customer_id, a.document_number, a.concluida_em, a.total_gross_value, 'Pendente'
    FROM alvo a
  RETURNING work_order_id, invoice_amount
)
SELECT a.os_number, c.invoice_amount FROM criado c JOIN alvo a ON a.id = c.work_order_id ORDER BY a.os_number;
