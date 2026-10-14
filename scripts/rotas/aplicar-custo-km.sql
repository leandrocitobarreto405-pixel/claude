-- Script único (14/10/2026): aplica o custo por km às rotas que ficaram "Aguardando custo por km"
-- antes de a empresa salvar o valor. Mesma conta do syncDailyRoute (route-auto.server.ts):
-- custo = km já calculado × custo por km; divisão igual entre os serviços concluídos (por horário),
-- a última parada leva a diferença dos centavos. Não recalcula o trajeto nem cria despesa
-- (a despesa sai no fechamento mensal de quilometragem).
-- Parâmetros: empresa, período e custo por km (troque antes de rodar).
WITH r AS (
  SELECT d.id, d.empresa_id, d.route_date, d.technician_id, d.calculated_km AS km,
         round(d.calculated_km * 0.57, 2) AS total
    FROM public.daily_routes d
   WHERE d.empresa_id = '11111111-1111-1111-1111-111111111111'
     AND d.route_status = 'Aguardando custo por km'
     AND d.route_date BETWEEN '2026-10-07' AND '2026-10-10'
     AND d.calculated_km > 0
     AND NOT EXISTS (SELECT 1 FROM public.route_cost_allocations a WHERE a.route_id = d.id)
), s AS (
  SELECT r.id AS route_id, r.empresa_id, r.km, r.total, v.id AS visit_id, v.work_order_id,
         row_number() OVER (PARTITION BY r.id ORDER BY v.scheduled_time, v.id) AS rn,
         count(*) OVER (PARTITION BY r.id) AS n
    FROM r
    JOIN public.visits v ON v.scheduled_date = r.route_date AND v.technician_id IS NOT DISTINCT FROM r.technician_id
    JOIN public.work_orders w ON w.id = v.work_order_id
   WHERE w.deleted_at IS NULL AND w.status IS DISTINCT FROM 'Cancelada'
     AND v.status IN ('Concluído', 'Reagendado com deslocamento', 'Cancelado após deslocamento')
), c AS (
  SELECT s.*, round(s.km / s.n, 2) AS km_por,
         CASE WHEN s.rn = s.n THEN s.total - round(s.total / s.n, 2) * (s.n - 1)
              ELSE round(s.total / s.n, 2) END AS custo
    FROM s
), ins AS (
  INSERT INTO public.route_cost_allocations
    (route_id, work_order_id, service_id, allocated_kilometers, allocated_cost, allocation_method, empresa_id)
  SELECT route_id, work_order_id, visit_id, km_por, custo, 'divisao_igual', empresa_id FROM c
  RETURNING service_id, allocated_cost
), upv AS (
  UPDATE public.visits v SET mileage_cost_allocated = ins.allocated_cost
    FROM ins WHERE v.id = ins.service_id
  RETURNING v.id
)
UPDATE public.daily_routes d
   SET cost_per_km = 0.57, total_cost = r.total, route_status = 'Custo gerado',
       allocation_method = 'divisao_igual', calculated_at = now(), error_message = NULL
  FROM r
 WHERE d.id = r.id
RETURNING d.route_date, d.calculated_km, d.total_cost, d.route_status,
          (SELECT count(*) FROM upv) AS servicos_rateados;
