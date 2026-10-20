/**
 * Consultas com tabelas embutidas que já quebraram em produção. visits e work_orders têm três
 * relações (visits.work_order_id, visits.recurrence_work_order_id e
 * work_orders.collection_visit_id): sem dizer a chave, o PostgREST recusa ("more than one
 * relationship"). Ficam aqui para o teste rodar exatamente o mesmo texto contra o banco
 * (supabase/tests/api/embutidos.test.ts).
 */

/** Início: vendas do período com origem e repasse do parceiro (work_orders). */
export const SELECT_OS_PAINEL =
  "id, sale_date, total_gross_value, status, eh_teste, sales_origin:sales_origin_id ( name ), visits!visits_work_order_id_fkey ( repasse_parceiro )" as const;

/** DRE: OS do período com o repasse do parceiro (work_orders). */
export const SELECT_OS_DRE =
  "id, total_gross_value, status, eh_teste, visits!visits_work_order_id_fkey ( repasse_parceiro )" as const;

/** Painel Nexa › Alice: leads com a OS e o repasse (crm_leads). */
export const SELECT_LEADS_ALICE_NEXA =
  "id, orcamento_em, os_criada_em, os:linked_work_order_id ( total_gross_value, eh_teste, cancelled_at, deleted_at, visits!visits_work_order_id_fkey ( repasse_parceiro ) )" as const;

/** Vendido pela data do serviço e A receber: OS com todas as visitas (work_orders). */
export const SELECT_OS_VENDIDO =
  "id, os_number, total_gross_value, status, eh_teste, deleted_at, sale_date, sales_origin:sales_origin_id ( name ), visits!visits_work_order_id_fkey ( id, status, scheduled_date, completion_date, visit_value, final_value, repasse_parceiro, discount_amount )" as const;
