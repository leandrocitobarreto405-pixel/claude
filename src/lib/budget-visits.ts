import { supabase } from "@/integrations/supabase/client";
import { renderMessage } from "@/lib/os";
import { brl, dateBR, timeBR, weekdayPT } from "@/lib/format";
import { cancelarEventoAgenda, sincronizarEventoAgenda } from "@/lib/calendar";

/** Visita técnica de orçamento: agendada sem abrir OS. */
export const BUDGET_VISIT_STATUSES = [
  "Agendado",
  "Confirmado",
  "Em deslocamento",
  "Realizado",
  "Reagendado",
  "Cancelado",
] as const;

export const BUDGET_VISIT_RESULTS = [
  "Orçamento aprovado",
  "Orçamento recusado",
  "Cliente vai avaliar",
  "Não foi possível orçar",
] as const;

/** Status que contam deslocamento realizado para efeito de rota. */
export const BUDGET_ROUTE_FINALIZED = ["Realizado"];
export const BUDGET_ROUTE_PENDING = ["Agendado", "Confirmado", "Em deslocamento", "Reagendado"];

export const BUDGET_VISIT_SELECT = `
  id, scheduled_date, scheduled_time, status, upholstery_description, notes, visit_fee,
  result, result_notes, completed_at, generated_work_order_id, mileage_cost_allocated,
  technician_id, customer_id, sales_origin_id,
  technician:technician_id ( id, name ),
  sales_origin:sales_origin_id ( id, name ),
  generated_work_order:generated_work_order_id ( id, os_number ),
  customer:customer_id (
    id, full_name, phone, email, full_address, street, street_number, complement,
    neighborhood, city, state, postal_code, reference_point
  )
`;

export type BudgetVisitRow = {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  upholstery_description: string | null;
  notes: string | null;
  visit_fee: number;
  result: string | null;
  result_notes: string | null;
  completed_at: string | null;
  generated_work_order_id: string | null;
  mileage_cost_allocated: number;
  technician_id: string | null;
  customer_id: string;
  sales_origin_id: string | null;
  technician: { id: string; name: string } | null;
  sales_origin: { id: string; name: string } | null;
  generated_work_order: { id: string; os_number: string } | null;
  customer: {
    id: string;
    full_name: string;
    phone: string;
    email: string | null;
    full_address: string | null;
    street: string | null;
    street_number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    reference_point: string | null;
  } | null;
};

export type BudgetVisitInput = {
  customer_id: string;
  technician_id: string | null;
  sales_origin_id: string | null;
  scheduled_date: string;
  scheduled_time: string;
  upholstery_description: string | null;
  notes: string | null;
  visit_fee: number;
  status?: string;
};

export async function createBudgetVisit(input: BudgetVisitInput, userId: string | null) {
  const { data, error } = await supabase
    .from("budget_visits")
    .insert({ ...input, created_by: userId } as never)
    .select("id")
    .single();
  if (error) throw error;
  const novo = data as { id: string };
  await sincronizarEventoAgenda("budget", novo.id);
  return novo;
}

export async function updateBudgetVisit(id: string, input: Partial<BudgetVisitInput>) {
  const { error } = await supabase
    .from("budget_visits")
    .update(input as never)
    .eq("id", id);
  if (error) throw error;
  await sincronizarEventoAgenda("budget", id);
}

export async function setBudgetVisitStatus(id: string, status: string) {
  const { error } = await supabase.from("budget_visits").update({ status }).eq("id", id);
  if (error) throw error;
  if (status === "Cancelado") await cancelarEventoAgenda("budget", id);
  else await sincronizarEventoAgenda("budget", id);
}

export async function completeBudgetVisit(args: {
  id: string;
  result: string;
  resultNotes: string | null;
}) {
  const { error } = await supabase
    .from("budget_visits")
    .update({
      status: "Realizado",
      result: args.result,
      result_notes: args.resultNotes,
      completed_at: new Date().toISOString(),
    })
    .eq("id", args.id);
  if (error) throw error;
}

export async function linkBudgetVisitToWorkOrder(id: string, workOrderId: string) {
  const { error } = await supabase
    .from("budget_visits")
    .update({ generated_work_order_id: workOrderId })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteBudgetVisit(id: string) {
  await cancelarEventoAgenda("budget", id);
  const { error } = await supabase.from("budget_visits").delete().eq("id", id);
  if (error) throw error;
}

/** Busca clientes por nome ou telefone para o seletor da visita de orçamento. */
export async function searchCustomers(term: string) {
  const t = term.trim();
  if (t.length < 2) return [];
  const digits = t.replace(/\D/g, "");
  const filtro = digits.length >= 4 ? `phone.ilike.%${digits}%,full_name.ilike.%${t}%` : `full_name.ilike.%${t}%`;
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, phone, full_address")
    .or(filtro)
    .order("full_name")
    .limit(15);
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    full_name: string;
    phone: string;
    full_address: string | null;
  }>;
}

/**
 * Mensagem de confirmação da visita de orçamento, usando o mesmo modelo
 * dos atendimentos. Sem taxa de visita, a mensagem não fala de valor.
 */
export function budgetVisitMessageContext(v: BudgetVisitRow, template?: unknown): string {
  const fee = Number(v.visit_fee ?? 0);
  const valorTexto = fee > 0 ? brl(fee) : "sem custo";
  const instrucao =
    fee > 0
      ? `Cobrar a taxa de visita de ${brl(fee)} no atendimento.`
      : "Visita de orçamento sem cobrança.";

  return renderMessage(template, {
    weekday: weekdayPT(v.scheduled_date),
    date: dateBR(v.scheduled_date),
    time: timeBR(v.scheduled_time),
    osNumber: "",
    customer: v.customer?.full_name ?? "",
    phone: v.customer?.phone ?? "",
    upholstery: v.upholstery_description ?? "",
    service: "Visita de orçamento",
    address: v.customer?.full_address ?? "",
    value: fee,
    technician: v.technician?.name ?? "",
    notes: v.notes ?? "",
    collection: {
      instrucaoPagamento: instrucao,
      valorACobrar: valorTexto,
      valorTotalCombinado: valorTexto,
      valorDoServico: valorTexto,
      formaPagamentoCombinada: fee > 0 ? "A combinar" : "",
      dataVisitaCobranca: "",
      servicoVisitaCobranca: "",
      isCollectionVisit: fee > 0,
    },
  });
}
