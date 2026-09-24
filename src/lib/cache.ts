import type { QueryClient } from "@tanstack/react-query";

/**
 * Chaves que dependem de valores financeiros (faturamento, a receber, agenda, despesas).
 * Qualquer alteração de pagamento, atendimento, OS ou despesa precisa invalidá-las
 * para que a tela inicial e os relatórios mostrem o número atualizado.
 */
const FINANCE_KEYS = [
  "month_summary",
  "a_receber",
  "pagamentos",
  "payments",
  "visits",
  "agenda",
  "expenses",
  "despesas",
  "pendencias",
  "os",
  "work_orders",
  "rotas",
  "goal",
];

export function invalidateFinanceQueries(qc: QueryClient) {
  for (const key of FINANCE_KEYS) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}
