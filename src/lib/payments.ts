import { supabase } from "@/integrations/supabase/client";
import { findRate, type PaymentRate } from "@/lib/data";

export const PAYMENT_REOPEN_REASONS = [
  "Forma de pagamento incorreta",
  "Número de parcelas incorreto",
  "Valor informado incorretamente",
  "Pagamento ainda não confirmado",
  "Estorno",
  "Outro",
] as const;

export type PaymentFull = {
  id: string;
  work_order_id: string;
  visit_id: string | null;
  payment_date: string | null;
  payment_channel: string;
  payment_type: string;
  installments: number;
  gross_amount: number;
  applied_rate: number;
  payment_fee_amount: number;
  net_amount: number;
  payment_status: string;
  notes: string | null;
  is_active: boolean;
  reopened_at: string | null;
  reopen_reason: string | null;
};

export type PaymentHistoryRow = {
  id: string;
  event_type: string;
  previous_payment_channel: string | null;
  previous_payment_type: string | null;
  previous_installments: number | null;
  previous_gross_amount: number | null;
  previous_applied_rate: number | null;
  previous_payment_fee_amount: number | null;
  previous_net_amount: number | null;
  previous_payment_date: string | null;
  previous_payment_status: string | null;
  new_payment_channel: string | null;
  new_payment_type: string | null;
  new_installments: number | null;
  new_gross_amount: number | null;
  new_applied_rate: number | null;
  new_payment_fee_amount: number | null;
  new_net_amount: number | null;
  new_payment_date: string | null;
  new_payment_status: string | null;
  reason: string | null;
  notes: string | null;
  changed_at: string;
};

export type PaymentFormValues = {
  payment_channel: string;
  payment_type: string;
  installments: number;
  gross_amount: number;
  payment_date: string | null;
  notes: string | null;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Calcula taxa, valor da taxa e valor líquido a partir da tabela de taxas vigente. */
export function computeFees(rates: PaymentRate[] | undefined, values: PaymentFormValues) {
  const rate = findRate(rates, values.payment_channel, values.payment_type, values.installments);
  const fee = round2((Number(values.gross_amount ?? 0) * rate) / 100);
  const net = round2(Number(values.gross_amount ?? 0) - fee);
  return { appliedRate: rate, feeAmount: fee, netAmount: net };
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function logHistory(
  payment: PaymentFull,
  eventType: string,
  next: Partial<PaymentFull> | null,
  reason: string | null,
  notes: string | null,
) {
  const changedBy = await currentUserId();
  const { error } = await supabase.from("payment_history").insert({
    payment_id: payment.id,
    work_order_id: payment.work_order_id,
    event_type: eventType,
    previous_payment_channel: payment.payment_channel,
    previous_payment_type: payment.payment_type,
    previous_installments: payment.installments,
    previous_gross_amount: payment.gross_amount,
    previous_applied_rate: payment.applied_rate,
    previous_payment_fee_amount: payment.payment_fee_amount,
    previous_net_amount: payment.net_amount,
    previous_payment_date: payment.payment_date,
    previous_payment_status: payment.payment_status,
    new_payment_channel: next?.payment_channel ?? null,
    new_payment_type: next?.payment_type ?? null,
    new_installments: next?.installments ?? null,
    new_gross_amount: next?.gross_amount ?? null,
    new_applied_rate: next?.applied_rate ?? null,
    new_payment_fee_amount: next?.payment_fee_amount ?? null,
    new_net_amount: next?.net_amount ?? null,
    new_payment_date: next?.payment_date ?? null,
    new_payment_status: next?.payment_status ?? null,
    reason,
    notes,
    changed_by: changedBy,
  } as never);
  if (error) throw error;
}

/**
 * Reabre um pagamento: ele deixa de contar como pago (fica "Não pago"),
 * o pagamento anterior é preservado no histórico e o motivo é obrigatório.
 */
export async function reopenPayment(payment: PaymentFull, reason: string, notes?: string | null) {
  if (!reason.trim()) throw new Error("Informe o motivo da reabertura do pagamento.");
  const reopenedAt = new Date().toISOString();
  const changedBy = await currentUserId();

  await logHistory(
    payment,
    "Reabertura",
    { payment_status: "Não pago", payment_date: null },
    reason,
    notes ?? null,
  );

  const { error } = await supabase
    .from("payments")
    .update({
      payment_status: "Não pago",
      payment_date: null,
      is_active: false,
      reopened_at: reopenedAt,
      reopened_by: changedBy,
      reopen_reason: reason,
    })
    .eq("id", payment.id);
  if (error) throw error;
}

/**
 * Registra (ou re-registra) o pagamento com a forma escolhida agora.
 * Recalcula taxa e valor líquido e reativa o pagamento nos cálculos.
 */
export async function registerPayment(
  payment: PaymentFull,
  values: PaymentFormValues,
  rates: PaymentRate[] | undefined,
  options?: { reason?: string | null },
) {
  if (!values.payment_channel) throw new Error("Selecione o canal de pagamento.");
  if (!values.payment_type) throw new Error("Selecione a forma de pagamento.");
  if (!values.payment_date) throw new Error("Informe a data do pagamento.");
  if (!(Number(values.gross_amount) > 0)) throw new Error("Informe o valor pago.");

  const { appliedRate, feeAmount, netAmount } = computeFees(rates, values);
  const next: Partial<PaymentFull> = {
    payment_channel: values.payment_channel,
    payment_type: values.payment_type,
    installments: values.installments,
    gross_amount: round2(Number(values.gross_amount)),
    applied_rate: appliedRate,
    payment_fee_amount: feeAmount,
    net_amount: netAmount,
    payment_date: values.payment_date,
    payment_status: "Pago",
  };

  const eventType = payment.payment_status === "Pago" ? "Edição" : "Novo registro";
  await logHistory(payment, eventType, next, options?.reason ?? null, values.notes ?? null);

  const { error } = await supabase
    .from("payments")
    .update({
      ...next,
      notes: values.notes ?? payment.notes,
      is_active: true,
      reopened_at: null,
      reopen_reason: null,
    } as never)
    .eq("id", payment.id);
  if (error) throw error;
}

/**
 * Cria um pagamento avulso para uma OS já concluída sem pagamento registrado.
 * Valida o total contra o valor combinado da OS e grava o histórico.
 */
export async function createPayment(args: {
  workOrderId: string;
  visitId: string | null;
  values: PaymentFormValues;
  rates: PaymentRate[] | undefined;
}) {
  const { workOrderId, visitId, values, rates } = args;
  if (!values.payment_channel) throw new Error("Selecione o canal de pagamento.");
  if (!values.payment_type) throw new Error("Selecione a forma de pagamento.");
  if (!values.payment_date) throw new Error("Informe a data do pagamento.");
  if (!(Number(values.gross_amount) > 0)) throw new Error("Informe o valor pago.");

  const [osRes, existingRes] = await Promise.all([
    supabase.from("work_orders").select("total_gross_value").eq("id", workOrderId).maybeSingle(),
    supabase.from("payments").select("gross_amount, is_active").eq("work_order_id", workOrderId),
  ]);
  if (osRes.error) throw osRes.error;
  if (existingRes.error) throw existingRes.error;

  const combinado = Number(osRes.data?.total_gross_value ?? 0);
  const jaPago = (existingRes.data ?? [])
    .filter((p) => p.is_active !== false)
    .reduce((s, p) => s + Number(p.gross_amount ?? 0), 0);
  const novoTotal = round2(jaPago + Number(values.gross_amount));
  if (combinado > 0 && novoTotal - combinado > 0.01) {
    throw new Error(
      `A soma dos pagamentos (R$ ${novoTotal.toFixed(2)}) ultrapassa o valor combinado da OS (R$ ${combinado.toFixed(2)}).`,
    );
  }

  const { appliedRate, feeAmount, netAmount } = computeFees(rates, values);
  const row = {
    work_order_id: workOrderId,
    visit_id: visitId,
    payment_channel: values.payment_channel,
    payment_type: values.payment_type,
    installments: values.installments,
    gross_amount: round2(Number(values.gross_amount)),
    applied_rate: appliedRate,
    payment_fee_amount: feeAmount,
    net_amount: netAmount,
    payment_date: values.payment_date,
    payment_status: "Pago",
    notes: values.notes ?? null,
    is_active: true,
  };

  const { data, error } = await supabase
    .from("payments")
    .insert(row as never)
    .select("*")
    .single();
  if (error) throw error;

  const created = data as unknown as PaymentFull;
  const changedBy = await currentUserId();
  const { error: histError } = await supabase.from("payment_history").insert({
    payment_id: created.id,
    work_order_id: workOrderId,
    event_type: "Novo registro",
    new_payment_channel: row.payment_channel,
    new_payment_type: row.payment_type,
    new_installments: row.installments,
    new_gross_amount: row.gross_amount,
    new_applied_rate: row.applied_rate,
    new_payment_fee_amount: row.payment_fee_amount,
    new_net_amount: row.net_amount,
    new_payment_date: row.payment_date,
    new_payment_status: row.payment_status,
    notes: values.notes ?? null,
    changed_by: changedBy,
  } as never);
  if (histError) throw histError;

  await supabase.from("work_order_history").insert({
    work_order_id: workOrderId,
    event_type: "Pagamento",
    description: `Pagamento lançado manualmente: ${row.payment_channel} · ${row.payment_type} · R$ ${row.gross_amount.toFixed(2)}`,
    details: { payment_id: created.id, visit_id: visitId } as never,
    created_by: changedBy,
  });

  return created;
}

export async function fetchPaymentHistory(paymentId: string) {
  const { data, error } = await supabase
    .from("payment_history")
    .select("*")
    .eq("payment_id", paymentId)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PaymentHistoryRow[];
}
