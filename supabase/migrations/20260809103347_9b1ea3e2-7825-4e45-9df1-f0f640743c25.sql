ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS os_type text NOT NULL DEFAULT 'venda',
  ADD COLUMN IF NOT EXISTS origin_work_order_id uuid REFERENCES public.work_orders(id),
  ADD COLUMN IF NOT EXISTS recurrence_reason text,
  ADD COLUMN IF NOT EXISTS recurrence_notes text;

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS recurrence_work_order_id uuid REFERENCES public.work_orders(id);

INSERT INTO public.config_options (kind, name, active, display_order)
SELECT 'recurrence_reason', n, true, o
FROM (VALUES
  ('Mancha retornou', 1),
  ('Cliente insatisfeito', 2),
  ('Falha no processo', 3),
  ('Secagem inadequada', 4),
  ('Uso indevido pelo cliente', 5),
  ('Outro motivo', 6)
) AS t(n, o)
WHERE NOT EXISTS (
  SELECT 1 FROM public.config_options c WHERE c.kind = 'recurrence_reason' AND c.name = t.n
);

-- Limpeza: mantém apenas o último conjunto de itens salvo por atendimento.
WITH lote AS (
  SELECT visit_id, max(created_at) AS ultimo FROM public.service_items GROUP BY visit_id
)
UPDATE public.service_items si
SET active = false
FROM lote l
WHERE si.visit_id = l.visit_id
  AND si.active = true
  AND si.created_at < l.ultimo - interval '5 seconds';

-- Ressincroniza a soma dos itens das OSs afetadas (valor combinado permanece intacto).
UPDATE public.work_orders wo
SET items_sum = COALESCE(s.soma, 0)
FROM (
  SELECT v.work_order_id, SUM(si.subtotal) AS soma
  FROM public.visits v
  JOIN public.service_items si ON si.visit_id = v.id AND si.active = true
  WHERE v.status <> 'Cancelado'
  GROUP BY v.work_order_id
) s
WHERE wo.id = s.work_order_id;