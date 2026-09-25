import { supabase } from "@/integrations/supabase/client";

export const EXPENSE_STATUS_LIST = [
  "Pendente",
  "Parcialmente pago",
  "Pago",
  "Vencido",
  "Cancelado",
] as const;

export type ExpenseStatus = (typeof EXPENSE_STATUS_LIST)[number];

export type ExpenseFull = {
  id: string;
  description: string;
  category: string;
  beneficiary: string | null;
  origin: string;
  competence_date: string;
  due_date: string | null;
  payment_date: string | null;
  payment_method: string | null;
  expected_amount: number;
  actual_amount: number | null;
  paid_amount: number;
  status: string;
  notes: string | null;
  recurring_expense_id: string | null;
  work_order_id: string | null;
  daily_route_id: string | null;
  reference_key: string | null;
  deleted_at: string | null;
  updated_at: string;
};

export type ExpenseHistoryRow = {
  id: string;
  previous_status: string | null;
  new_status: string;
  previous_paid_amount: number | null;
  new_paid_amount: number | null;
  previous_payment_date: string | null;
  new_payment_date: string | null;
  changed_at: string;
  reason: string | null;
  notes: string | null;
};

export function remainingAmount(e: {
  expected_amount: number;
  paid_amount?: number | null;
  status?: string;
}): number {
  if (e.status === "Cancelado") return 0;
  const rest = Number(e.expected_amount ?? 0) - Number(e.paid_amount ?? 0);
  return Math.round(Math.max(0, rest) * 100) / 100;
}

/** Valor que entra no caixa: apenas o que foi realmente pago. */
export function cashPaidAmount(e: {
  status: string;
  paid_amount?: number | null;
  actual_amount?: number | null;
}): number {
  if (e.status === "Cancelado") return 0;
  const paid = Number(e.paid_amount ?? 0);
  if (paid > 0) return paid;
  if (e.status === "Pago") return Number(e.actual_amount ?? 0);
  return 0;
}

export async function fetchExpenseHistory(expenseId: string) {
  const { data, error } = await supabase
    .from("expense_status_history")
    .select(
      "id, previous_status, new_status, previous_paid_amount, new_paid_amount, previous_payment_date, new_payment_date, changed_at, reason, notes",
    )
    .eq("expense_id", expenseId)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ExpenseHistoryRow[];
}

async function logStatus(args: {
  expense: ExpenseFull;
  newStatus: string;
  newPaid: number | null;
  newPaymentDate: string | null;
  userId: string | null;
  reason?: string | null;
  notes?: string | null;
}) {
  await supabase.from("expense_status_history").insert({
    expense_id: args.expense.id,
    previous_status: args.expense.status,
    new_status: args.newStatus,
    previous_paid_amount: Number(args.expense.paid_amount ?? 0),
    new_paid_amount: args.newPaid,
    previous_payment_date: args.expense.payment_date,
    new_payment_date: args.newPaymentDate,
    changed_by: args.userId,
    reason: args.reason ?? null,
    notes: args.notes ?? null,
  });
}

/** Registra (ou ajusta) o pagamento de uma despesa. */
export async function payExpense(args: {
  expense: ExpenseFull;
  amount: number;
  paymentDate: string;
  paymentMethod: string | null;
  notes?: string | null;
  partial?: boolean;
  userId: string | null;
}) {
  const paid = Math.round(Math.max(0, args.amount) * 100) / 100;
  const status: ExpenseStatus =
    args.partial && paid < Number(args.expense.expected_amount ?? 0) ? "Parcialmente pago" : "Pago";
  const { error } = await supabase
    .from("expenses")
    .update({
      status,
      paid_amount: paid,
      actual_amount: paid,
      payment_date: args.paymentDate,
      payment_method: args.paymentMethod,
      notes: args.notes ?? args.expense.notes,
      updated_by: args.userId,
    })
    .eq("id", args.expense.id);
  if (error) throw error;
  await logStatus({
    expense: args.expense,
    newStatus: status,
    newPaid: paid,
    newPaymentDate: args.paymentDate,
    userId: args.userId,
    reason: "Registro de pagamento",
    notes: args.notes ?? null,
  });
}

/** Reabre uma despesa paga como pendente, preservando o histórico do pagamento. */
export async function reopenExpense(args: {
  expense: ExpenseFull;
  reason: string | null;
  userId: string | null;
}) {
  const { error } = await supabase
    .from("expenses")
    .update({
      status: "Pendente",
      paid_amount: 0,
      actual_amount: null,
      payment_date: null,
      payment_method: null,
      updated_by: args.userId,
    })
    .eq("id", args.expense.id);
  if (error) throw error;
  await logStatus({
    expense: args.expense,
    newStatus: "Pendente",
    newPaid: 0,
    newPaymentDate: null,
    userId: args.userId,
    reason: args.reason ?? "Despesa reaberta como pendente",
  });
}

/** Muda o status livremente (Pendente, Vencido, Cancelado). */
export async function setExpenseStatus(args: {
  expense: ExpenseFull;
  status: ExpenseStatus;
  reason?: string | null;
  userId: string | null;
}) {
  const clearsPayment =
    args.status === "Pendente" || args.status === "Cancelado" || args.status === "Vencido";
  const { error } = await supabase
    .from("expenses")
    .update({
      status: args.status,
      ...(clearsPayment
        ? { paid_amount: 0, actual_amount: null, payment_date: null, payment_method: null }
        : {}),
      updated_by: args.userId,
    })
    .eq("id", args.expense.id);
  if (error) throw error;
  await logStatus({
    expense: args.expense,
    newStatus: args.status,
    newPaid: clearsPayment ? 0 : Number(args.expense.paid_amount ?? 0),
    newPaymentDate: clearsPayment ? null : args.expense.payment_date,
    userId: args.userId,
    reason: args.reason ?? null,
  });
}

export async function updateExpense(args: {
  id: string;
  description: string;
  category: string;
  beneficiary: string | null;
  competence_date: string;
  due_date: string | null;
  expected_amount: number;
  notes: string | null;
  userId: string | null;
}) {
  const { error } = await supabase
    .from("expenses")
    .update({
      description: args.description,
      category: args.category,
      beneficiary: args.beneficiary,
      competence_date: args.competence_date,
      due_date: args.due_date,
      expected_amount: args.expected_amount,
      notes: args.notes,
      updated_by: args.userId,
    })
    .eq("id", args.id);
  if (error) throw error;
}

/** Exclusão suave: a despesa sai do DRE e do caixa, mas o histórico é preservado. */
export async function softDeleteExpense(args: {
  expense: ExpenseFull;
  reason: string | null;
  userId: string | null;
}) {
  const { error } = await supabase
    .from("expenses")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: args.userId,
      status: "Cancelado",
      updated_by: args.userId,
    })
    .eq("id", args.expense.id);
  if (error) throw error;
  await logStatus({
    expense: args.expense,
    newStatus: "Cancelado",
    newPaid: 0,
    newPaymentDate: null,
    userId: args.userId,
    reason: args.reason ?? "Despesa excluída",
  });
}
