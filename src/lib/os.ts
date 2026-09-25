import { supabase } from "@/integrations/supabase/client";
import { brl, buildFullAddress, dateBR, timeBR, todayISO, weekdayPT } from "@/lib/format";
import { DEFAULT_MESSAGE_TEMPLATE } from "@/lib/data";
import { effectiveVisitValue } from "@/lib/visit-value";
import { syncRecurringMonth } from "@/lib/recurring-core";
import { sincronizarRotaDoDia } from "@/lib/routes.functions";
import {
  cancelarEventoAgenda,
  reagendarEventoAgenda,
  sincronizarEventoAgenda,
} from "@/lib/calendar";
import {
  collectionFields,
  type CollectionFields,
  type CollectionSetup,
  type CollectionVisit,
} from "@/lib/collection";

export type CustomerInput = {
  full_name: string;
  phone: string;
  email?: string | null;
  document_number?: string | null;
  street?: string | null;
  street_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  reference_point?: string | null;
  notes?: string | null;
};

export type ServiceItemInput = {
  id?: string | null;
  upholstery_type_id: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  item_group_id: string;
  display_order: number;
};

export type VisitInput = {
  id?: string | null;
  service_type_id: string | null;
  scheduled_date: string;
  scheduled_time: string;
  technician_id: string | null;
  visit_notes?: string | null;
  items: ServiceItemInput[];
};

export function itemSubtotal(item: { quantity: number; unit_price: number }) {
  return Math.round(Math.max(0, item.quantity) * Math.max(0, item.unit_price) * 100) / 100;
}

export function visitTotal(items: Array<{ quantity: number; unit_price: number }>) {
  return Math.round(items.reduce((s, i) => s + itemSubtotal(i), 0) * 100) / 100;
}

export type WorkOrderInput = {
  os_number: string;
  sale_date: string;
  sales_origin_id: string | null;
  salesperson_id: string | null;
  negotiated_payment_method: string | null;
  negotiated_installments: number | null;
  payment_notes: string | null;
  general_notes: string | null;
  total_gross_value: number;
  os_value_text: string | null;
  adjustment_reason: string | null;
  manual_total_reason: string | null;
  collection_rule?: string | null;
  collection_visit_index?: number | null;
  payment_instruction?: string | null;
};

export async function osNumberExists(osNumber: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("work_orders")
    .select("id")
    .eq("os_number", osNumber.trim())
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function suggestOsNumber(): Promise<string> {
  const { data } = await supabase
    .from("work_orders")
    .select("os_number")
    .order("created_at", { ascending: false })
    .limit(50);
  const numeric = (data ?? [])
    .map((r) => Number(String(r.os_number).replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  const next = numeric.length ? Math.max(...numeric) + 1 : 1;
  return String(next).padStart(4, "0");
}

export async function findCustomerByPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const { data } = await supabase
    .from("customers")
    .select("*")
    .ilike("phone", `%${digits.slice(-8)}%`)
    .limit(1);
  return data?.[0] ?? null;
}

export async function upsertCustomer(input: CustomerInput, existingId?: string | null) {
  const full_address = buildFullAddress(input);
  const payload = { ...input, full_address };
  if (existingId) {
    const { data, error } = await supabase
      .from("customers")
      .update(payload)
      .eq("id", existingId)
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }
  const { data, error } = await supabase.from("customers").insert(payload).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function logOsHistory(args: {
  workOrderId: string;
  eventType: string;
  description: string;
  details?: Record<string, unknown>;
  userId?: string | null;
}) {
  await supabase.from("work_order_history").insert({
    work_order_id: args.workOrderId,
    event_type: args.eventType,
    description: args.description,
    details: (args.details ?? {}) as never,
    created_by: args.userId ?? null,
  });
}

function visitLegacyFields(v: VisitInput) {
  const ativos = v.items.filter((i) => i.quantity > 0);
  return {
    visit_value: visitTotal(ativos),
    item_quantity: ativos.reduce((s, i) => s + i.quantity, 0) || 1,
    upholstery_type_id: ativos[0]?.upholstery_type_id ?? null,
    upholstery_description:
      ativos
        .map((i) => `${i.quantity}x ${i.description || ""}`.trim())
        .filter(Boolean)
        .join(", ") || null,
  };
}

/**
 * Reconcilia os itens do atendimento sem depender de permissão de exclusão:
 * item existente é atualizado, item novo é inserido e item removido é desativado.
 */
async function saveVisitItems(visitId: string, items: ServiceItemInput[]) {
  const { data: atuais, error: readError } = await supabase
    .from("service_items")
    .select("id")
    .eq("visit_id", visitId)
    .eq("active", true);
  if (readError) throw readError;

  const validos = items.filter((i) => i.quantity > 0);
  const manter = new Set<string>();

  for (const [idx, i] of validos.entries()) {
    const payload = {
      visit_id: visitId,
      upholstery_type_id: i.upholstery_type_id,
      description: i.description,
      quantity: i.quantity,
      unit_price: i.unit_price,
      subtotal: itemSubtotal(i),
      item_group_id: i.item_group_id,
      display_order: i.display_order ?? idx,
      active: true,
    };
    const existente = i.id && (atuais ?? []).some((a) => a.id === i.id) ? i.id : null;
    if (existente) {
      const { error } = await supabase.from("service_items").update(payload).eq("id", existente);
      if (error) throw error;
      manter.add(existente);
    } else {
      const { data: novo, error } = await supabase
        .from("service_items")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      manter.add(novo.id);
    }
  }

  const desativar = (atuais ?? []).map((a) => a.id).filter((id) => !manter.has(id));
  if (desativar.length) {
    const { error } = await supabase
      .from("service_items")
      .update({ active: false })
      .in("id", desativar);
    if (error) throw error;
  }
}

function orderPayload(order: WorkOrderInput, itemsSum: number) {
  return {
    sale_date: order.sale_date,
    sales_origin_id: order.sales_origin_id,
    salesperson_id: order.salesperson_id,
    total_gross_value: order.total_gross_value,
    items_sum: itemsSum,
    os_value_text: order.os_value_text,
    adjustment_reason: order.adjustment_reason,
    manual_total_reason: order.manual_total_reason,
    negotiated_payment_method: order.negotiated_payment_method,
    negotiated_installments: order.negotiated_installments,
    payment_notes: order.payment_notes,
    general_notes: order.general_notes,
    collection_rule: order.collection_rule ?? null,
    payment_instruction: order.payment_instruction ?? null,
    collection_configuration_updated_at: new Date().toISOString(),
  };
}

/** Grava a visita responsável pela cobrança, resolvida pela posição na lista de atendimentos. */
async function saveCollectionVisit(
  workOrderId: string,
  order: WorkOrderInput,
  visitIds: Array<string | null>,
) {
  const index = order.collection_visit_index;
  const visitId =
    index != null && index >= 0 && index < visitIds.length ? (visitIds[index] ?? null) : null;
  await supabase.from("work_orders").update({ collection_visit_id: visitId }).eq("id", workOrderId);
}

export async function createWorkOrder(args: {
  customer: CustomerInput;
  customerId?: string | null;
  order: WorkOrderInput;
  visits: VisitInput[];
  commissionPercentage: number;
  userId: string | null;
}) {
  const customerId = await upsertCustomer(args.customer, args.customerId ?? null);
  const commissionExpected =
    Math.round(((args.order.total_gross_value * args.commissionPercentage) / 100) * 100) / 100;
  const itemsSum = Math.round(args.visits.reduce((s, v) => s + visitTotal(v.items), 0) * 100) / 100;

  const { data: wo, error } = await supabase
    .from("work_orders")
    .insert({
      ...orderPayload(args.order, itemsSum),
      os_number: args.order.os_number.trim(),
      customer_id: customerId,
      status: "Agendada",
      commission_percentage_snapshot: args.commissionPercentage,
      commission_expected: commissionExpected,
      created_by: args.userId,
      updated_by: args.userId,
    })
    .select("id, os_number")
    .single();
  if (error) throw error;

  const visitIds: Array<string | null> = [];
  for (const v of args.visits) {
    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .insert({
        work_order_id: wo.id,
        service_type_id: v.service_type_id,
        scheduled_date: v.scheduled_date,
        scheduled_time: v.scheduled_time,
        technician_id: v.technician_id,
        visit_notes: v.visit_notes ?? null,
        status: "Agendado",
        ...visitLegacyFields(v),
      })
      .select("id")
      .single();
    if (visitError) throw visitError;
    visitIds.push(visit.id);
    await saveVisitItems(visit.id, v.items);
  }

  await saveCollectionVisit(wo.id, args.order, visitIds);

  for (const id of visitIds) await sincronizarEventoAgenda("visit", id);

  await logOsHistory({
    workOrderId: wo.id,
    eventType: "Criação",
    description: `OS ${wo.os_number} criada com ${args.visits.length} serviço(s).`,
    userId: args.userId,
  });

  return wo;
}

/**
 * Repassa o valor total negociado da OS para os atendimentos concluídos.
 * O rateio segue o valor de cada atendimento; a sobra de arredondamento fica no último.
 */
async function syncCompletedVisitValues(
  workOrderId: string,
  negotiatedTotal: number,
  userId: string | null,
) {
  const { data } = await supabase
    .from("visits")
    .select("id, status, visit_value, final_value")
    .eq("work_order_id", workOrderId);
  const active = (data ?? []).filter((v) => v.status !== "Cancelado");
  const done = active.filter((v) => v.status === "Concluído");
  if (!done.length || !(negotiatedTotal > 0)) return;

  const base = active.reduce((s, v) => s + effectiveVisitValue(v), 0);
  const shares = active.map((v) =>
    base > 0
      ? Math.round(((negotiatedTotal * effectiveVisitValue(v)) / base) * 100) / 100
      : Math.round((negotiatedTotal / active.length) * 100) / 100,
  );
  const diff = Math.round((negotiatedTotal - shares.reduce((s, n) => s + n, 0)) * 100) / 100;
  if (shares.length)
    shares[shares.length - 1] = Math.round((shares[shares.length - 1]! + diff) * 100) / 100;

  const ajustes: Array<{ id: string; de: number; para: number }> = [];
  for (const [idx, v] of active.entries()) {
    if (v.status !== "Concluído") continue;
    const novo = shares[idx] ?? 0;
    const atual = effectiveVisitValue(v);
    if (Math.abs(novo - atual) < 0.01) continue;
    const { error } = await supabase
      .from("visits")
      .update({
        final_value: novo,
        value_change_reason: "Valor total da OS alterado na edição.",
      })
      .eq("id", v.id);
    if (error) throw error;
    ajustes.push({ id: v.id, de: atual, para: novo });
  }

  if (ajustes.length) {
    await logOsHistory({
      workOrderId,
      eventType: "Ajuste de valor",
      description: `Valor de ${ajustes.length} atendimento(s) concluído(s) atualizado para o novo total da OS.`,
      details: { negotiatedTotal, ajustes },
      userId,
    });
  }
}

export async function updateWorkOrder(args: {
  workOrderId: string;
  customer: CustomerInput;
  customerId: string;
  order: WorkOrderInput;
  visits: VisitInput[];
  commissionPercentage: number;
  userId: string | null;
}) {
  await upsertCustomer(args.customer, args.customerId);
  const itemsSum = Math.round(args.visits.reduce((s, v) => s + visitTotal(v.items), 0) * 100) / 100;
  const commissionExpected =
    Math.round(((args.order.total_gross_value * args.commissionPercentage) / 100) * 100) / 100;

  const { error } = await supabase
    .from("work_orders")
    .update({
      ...orderPayload(args.order, itemsSum),
      commission_percentage_snapshot: args.commissionPercentage,
      commission_expected: commissionExpected,
      updated_by: args.userId,
    })
    .eq("id", args.workOrderId);
  if (error) throw error;

  const { data: atuais } = await supabase
    .from("visits")
    .select("id, status, technician_travel_occurred")
    .eq("work_order_id", args.workOrderId);
  const manter = new Set(args.visits.map((v) => v.id).filter(Boolean) as string[]);

  const visitIds: Array<string | null> = [];
  for (const v of args.visits) {
    const payload = {
      service_type_id: v.service_type_id,
      scheduled_date: v.scheduled_date,
      scheduled_time: v.scheduled_time,
      technician_id: v.technician_id,
      visit_notes: v.visit_notes ?? null,
      ...visitLegacyFields(v),
    };
    if (v.id) {
      const { error: e } = await supabase.from("visits").update(payload).eq("id", v.id);
      if (e) throw e;
      await saveVisitItems(v.id, v.items);
      visitIds.push(v.id);
    } else {
      const { data: novo, error: e } = await supabase
        .from("visits")
        .insert({ work_order_id: args.workOrderId, status: "Agendado", ...payload })
        .select("id")
        .single();
      if (e) throw e;
      await saveVisitItems(novo.id, v.items);
      visitIds.push(novo.id);
    }
  }

  await saveCollectionVisit(args.workOrderId, args.order, visitIds);

  for (const v of atuais ?? []) {
    if (!manter.has(v.id)) {
      if (v.status === "Concluído") continue;
      // Visitas com deslocamento contabilizado permanecem no histórico e na rota.
      if (v.status === TRAVEL_RESCHEDULE_STATUS || v.technician_travel_occurred) continue;
      await cancelarEventoAgenda("visit", v.id);
      await supabase.from("service_items").update({ active: false }).eq("visit_id", v.id);
      const { error: delError } = await supabase.from("visits").delete().eq("id", v.id);
      // Sem permissão de exclusão o atendimento é cancelado, para não voltar na agenda.
      if (delError) await supabase.from("visits").update({ status: "Cancelado" }).eq("id", v.id);
    }
  }

  for (const id of visitIds) await sincronizarEventoAgenda("visit", id);

  await syncCompletedVisitValues(args.workOrderId, args.order.total_gross_value, args.userId);
  await recalcWorkOrder(args.workOrderId, args.userId);

  await logOsHistory({
    workOrderId: args.workOrderId,
    eventType: "Edição",
    description: "Dados da OS atualizados.",
    userId: args.userId,
  });
}

export async function cancelWorkOrder(args: {
  workOrderId: string;
  reason: string;
  userId: string | null;
}) {
  const { error } = await supabase
    .from("work_orders")
    .update({
      status: "Cancelada",
      cancellation_reason: args.reason,
      cancelled_at: new Date().toISOString(),
      cancelled_by: args.userId,
      updated_by: args.userId,
    })
    .eq("id", args.workOrderId);
  if (error) throw error;
  const { data: canceladas } = await supabase
    .from("visits")
    .select("id")
    .eq("work_order_id", args.workOrderId)
    .neq("status", "Concluído");
  await supabase
    .from("visits")
    .update({ status: "Cancelado" })
    .eq("work_order_id", args.workOrderId)
    .neq("status", "Concluído");
  for (const v of canceladas ?? []) await cancelarEventoAgenda("visit", v.id);
  await logOsHistory({
    workOrderId: args.workOrderId,
    eventType: "Cancelamento",
    description: `OS cancelada. Motivo: ${args.reason}`,
    userId: args.userId,
  });
}

export async function softDeleteWorkOrder(args: {
  workOrderId: string;
  reason: string;
  userId: string | null;
}) {
  const { error } = await supabase
    .from("work_orders")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: args.userId,
      deletion_reason: args.reason,
      updated_by: args.userId,
    })
    .eq("id", args.workOrderId);
  if (error) throw error;
  await supabase
    .from("visits")
    .update({ status: "Cancelado" })
    .eq("work_order_id", args.workOrderId)
    .neq("status", "Concluído");
  await logOsHistory({
    workOrderId: args.workOrderId,
    eventType: "Exclusão",
    description: `OS excluída. Motivo: ${args.reason}`,
    userId: args.userId,
  });
}

export async function restoreWorkOrder(args: { workOrderId: string; userId: string | null }) {
  const { error } = await supabase
    .from("work_orders")
    .update({ deleted_at: null, deleted_by: null, deletion_reason: null, updated_by: args.userId })
    .eq("id", args.workOrderId);
  if (error) throw error;
  await logOsHistory({
    workOrderId: args.workOrderId,
    eventType: "Restauração",
    description: "OS restaurada.",
    userId: args.userId,
  });
}

export type PaymentPart = {
  payment_channel: string;
  payment_type: string;
  installments: number;
  gross_amount: number;
  applied_rate: number;
  payment_date: string;
  notes?: string | null;
};

export async function completeVisit(args: {
  visitId: string;
  workOrderId: string;
  finalValue: number;
  changeReason: string | null;
  completionDate: string;
  completionTime: string;
  finalNotes: string | null;
  paymentStatus: string;
  payments: PaymentPart[];
  invoiceNeeded: boolean;
  invoiceIssued: boolean;
  invoiceNumber: string | null;
  userId: string | null;
}) {
  const { error: visitError } = await supabase
    .from("visits")
    .update({
      status: "Concluído",
      final_value: args.finalValue,
      value_change_reason: args.changeReason,
      completion_date: args.completionDate,
      completion_time: args.completionTime,
      visit_notes: args.finalNotes,
    })
    .eq("id", args.visitId);
  if (visitError) throw visitError;

  if (args.payments.length) {
    const rows = args.payments.map((p) => {
      const fee = Math.round(((p.gross_amount * p.applied_rate) / 100) * 100) / 100;
      return {
        work_order_id: args.workOrderId,
        visit_id: args.visitId,
        payment_date: p.payment_date,
        payment_channel: p.payment_channel,
        payment_type: p.payment_type,
        installments: p.installments,
        gross_amount: p.gross_amount,
        applied_rate: p.applied_rate,
        payment_fee_amount: fee,
        net_amount: Math.round((p.gross_amount - fee) * 100) / 100,
        payment_status: args.paymentStatus,
        notes: p.notes ?? null,
      };
    });
    const { error } = await supabase.from("payments").insert(rows);
    if (error) throw error;
  }

  await recalcWorkOrder(args.workOrderId, args.userId);

  if (args.invoiceNeeded && !args.invoiceIssued) {
    const { data: wo } = await supabase
      .from("work_orders")
      .select("id, customer_id, customers(document_number)")
      .eq("id", args.workOrderId)
      .single();
    const { data: existing } = await supabase
      .from("invoice_tasks")
      .select("id")
      .eq("work_order_id", args.workOrderId)
      .maybeSingle();
    if (!existing) {
      await supabase.from("invoice_tasks").insert({
        work_order_id: args.workOrderId,
        customer_id: wo?.customer_id ?? null,
        document_number:
          (wo as { customers?: { document_number?: string | null } } | null)?.customers
            ?.document_number ?? null,
        service_date: args.completionDate,
        invoice_amount: args.finalValue,
        status: "Pendente",
      });
    }
  } else if (args.invoiceNeeded && args.invoiceIssued) {
    const { data: existing } = await supabase
      .from("invoice_tasks")
      .select("id")
      .eq("work_order_id", args.workOrderId)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("invoice_tasks")
        .update({
          status: "Emitida",
          invoice_number: args.invoiceNumber,
          issue_date: args.completionDate,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("invoice_tasks").insert({
        work_order_id: args.workOrderId,
        service_date: args.completionDate,
        invoice_amount: args.finalValue,
        status: "Emitida",
        invoice_number: args.invoiceNumber,
        issue_date: args.completionDate,
      });
    }
  }

  await triggerDailyRouteSync(args.visitId);
}

/** Dispara a rota automática do dia do técnico, sem interromper a conclusão do serviço. */
async function triggerDailyRouteSync(visitId: string) {
  try {
    const { data: visit } = await supabase
      .from("visits")
      .select("scheduled_date, technician_id")
      .eq("id", visitId)
      .maybeSingle();
    if (!visit?.scheduled_date) return;
    await sincronizarRotaDoDia({
      data: {
        date: visit.scheduled_date,
        technicianId: visit.technician_id ?? null,
        source: "automática",
      },
    });
  } catch (error) {
    console.error("Não foi possível calcular a rota automaticamente.", error);
  }
}

/** Recalcula status, valor bruto final e comissão realizada da OS. */
export async function recalcWorkOrder(workOrderId: string, userId: string | null) {
  const { data: visits } = await supabase
    .from("visits")
    .select("status, visit_value, final_value")
    .eq("work_order_id", workOrderId);
  const list = visits ?? [];
  const active = list.filter((v) => v.status !== "Cancelado");
  const done = active.filter((v) => v.status === "Concluído");
  const total = active.reduce((sum, v) => sum + effectiveVisitValue(v), 0);
  const realizedBase = done.reduce((sum, v) => sum + effectiveVisitValue(v), 0);

  const { data: wo } = await supabase
    .from("work_orders")
    .select("commission_percentage_snapshot, status, total_gross_value")
    .eq("id", workOrderId)
    .single();
  const pctSnapshot = Number(wo?.commission_percentage_snapshot ?? 0);
  // O valor negociado da OS é a base financeira e não é sobrescrito pelos itens.
  const negociado = Number(wo?.total_gross_value ?? 0) || Math.round(total * 100) / 100;
  const proporcaoConcluida = total > 0 ? realizedBase / total : 0;

  let status = wo?.status ?? "Agendada";
  if (active.length === 0) status = "Cancelada";
  else if (done.length === active.length) status = "Concluída";
  else if (done.length > 0) status = "Parcialmente concluída";

  await supabase
    .from("work_orders")
    .update({
      items_sum: Math.round(total * 100) / 100,
      status,
      commission_expected: Math.round(((negociado * pctSnapshot) / 100) * 100) / 100,
      commission_realized:
        Math.round(((negociado * proporcaoConcluida * pctSnapshot) / 100) * 100) / 100,
      updated_by: userId,
    })
    .eq("id", workOrderId);
}

export type MessageContext = {
  weekday: string;
  date: string;
  time: string;
  osNumber: string;
  customer: string;
  phone: string;
  upholstery: string;
  service: string;
  address: string;
  value: number;
  technician: string;
  notes: string;
  collection?: CollectionFields | null;
};

/** Aceita string ou objeto ({ body }) vindo das configurações salvas em JSON. */
export function templateText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const body =
      (value as { body?: unknown; template?: unknown }).body ??
      (value as { template?: unknown }).template;
    if (typeof body === "string") return body;
  }
  return "";
}

/**
 * Modelos antigos terminavam com "Valor: {{valor_formatado}}", que imprime o valor daquele
 * atendimento — no dia da higienização isso parecia uma cobrança. Sem a variável de
 * pagamento, a linha de valor passa a ser a instrução de cobrança da OS.
 */
export function normalizeMessageTemplate(text: string): string {
  if (text.includes("{{INSTRUCAO_PAGAMENTO}}")) return text;
  if (!text.includes("{{valor_formatado}}")) return text;
  const linhas = text.split("\n");
  let trocou = false;
  const saida = linhas
    .map((linha) => {
      if (!linha.includes("{{valor_formatado}}")) return linha;
      if (trocou) return null;
      trocou = true;
      return "{{INSTRUCAO_PAGAMENTO}}";
    })
    .filter((l): l is string => l !== null);
  return saida.join("\n");
}

export function renderMessage(template: unknown, ctx: MessageContext): string {
  const raw = templateText(template);
  const base = normalizeMessageTemplate(raw.trim() ? raw : DEFAULT_MESSAGE_TEMPLATE);
  const c = ctx.collection ?? null;

  return base
    .replaceAll("{{dia_da_semana}}", ctx.weekday)
    .replaceAll("{{data}}", ctx.date)
    .replaceAll("{{horario}}", ctx.time)
    .replaceAll("{{numero_os}}", ctx.osNumber)
    .replaceAll("{{nome_cliente}}", ctx.customer)
    .replaceAll("{{telefone}}", ctx.phone)
    .replaceAll("{{descricao_estofado}}", ctx.upholstery)
    .replaceAll("{{servico}}", ctx.service)
    .replaceAll("{{endereco_completo}}", ctx.address)
    .replaceAll("{{valor_formatado}}", brl(ctx.value))
    .replaceAll("{{tecnico}}", ctx.technician)
    .replaceAll("{{observacao}}", ctx.notes)
    .replaceAll("{{INSTRUCAO_PAGAMENTO}}", c?.instrucaoPagamento ?? `Valor: ${brl(ctx.value)}`)
    .replaceAll("{{VALOR_A_COBRAR}}", c?.valorACobrar ?? brl(ctx.value))
    .replaceAll("{{VALOR_TOTAL_COMBINADO}}", c?.valorTotalCombinado ?? brl(ctx.value))
    .replaceAll("{{VALOR_DO_SERVICO}}", c?.valorDoServico ?? brl(ctx.value))
    .replaceAll("{{FORMA_PAGAMENTO_COMBINADA}}", c?.formaPagamentoCombinada ?? "")
    .replaceAll("{{DATA_VISITA_COBRANCA}}", c?.dataVisitaCobranca ?? "")
    .replaceAll("{{SERVICO_VISITA_COBRANCA}}", c?.servicoVisitaCobranca ?? "");
}

export const VISIT_SELECT = `
  id, scheduled_date, scheduled_time, status, visit_value, final_value, upholstery_description,
  completion_date, completion_time, visit_notes, mileage_cost_allocated, work_order_id,
  technician_id, service_type_id,
  reschedule_type, technician_travel_occurred, preserve_original_route, reschedule_reason,
  reschedule_notes, original_scheduled_date, rescheduled_from_visit_id, rescheduled_to_visit_id,
  rescheduled_to:rescheduled_to_visit_id ( id, scheduled_date, scheduled_time, status ),
  rescheduled_from:rescheduled_from_visit_id ( id, scheduled_date, scheduled_time, status ),
  service_type:service_type_id ( id, name ),
  upholstery_type:upholstery_type_id ( id, name ),
  technician:technician_id ( id, name, base_address ),
  work_order:work_order_id (
    id, os_number, sale_date, total_gross_value, status, general_notes,
    negotiated_payment_method, negotiated_installments,
    collection_rule, collection_visit_id, payment_instruction,
    commission_percentage_snapshot, commission_expected, commission_realized,
    salesperson:salesperson_id ( id, name ),
    sales_origin:sales_origin_id ( id, name ),
    customer:customer_id (
      id, full_name, phone, email, document_number, full_address, street, street_number,
      complement, neighborhood, city, state, postal_code, reference_point
    )
  )
`;

export type VisitRow = {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  visit_value: number;
  final_value: number | null;
  upholstery_description: string | null;
  completion_date: string | null;
  completion_time: string | null;
  visit_notes: string | null;
  mileage_cost_allocated: number;
  work_order_id?: string;
  technician_id?: string | null;
  service_type_id?: string | null;
  reschedule_type?: string | null;
  technician_travel_occurred?: boolean | null;
  preserve_original_route?: boolean | null;
  reschedule_reason?: string | null;
  reschedule_notes?: string | null;
  original_scheduled_date?: string | null;
  rescheduled_from_visit_id?: string | null;
  rescheduled_to_visit_id?: string | null;
  rescheduled_to?: {
    id: string;
    scheduled_date: string;
    scheduled_time: string;
    status: string;
  } | null;
  rescheduled_from?: {
    id: string;
    scheduled_date: string;
    scheduled_time: string;
    status: string;
  } | null;
  service_type: { id: string; name: string } | null;
  upholstery_type: { id: string; name: string } | null;
  technician: { id: string; name: string; base_address: string | null } | null;
  work_order: {
    id: string;
    os_number: string;
    sale_date: string;
    total_gross_value: number;
    status: string;
    general_notes: string | null;
    negotiated_payment_method: string | null;
    negotiated_installments: number | null;
    collection_rule?: string | null;
    collection_visit_id?: string | null;
    payment_instruction?: string | null;
    commission_percentage_snapshot: number | null;
    commission_expected: number;
    commission_realized: number;
    salesperson: { id: string; name: string } | null;
    sales_origin: { id: string; name: string } | null;
    customer: {
      id: string;
      full_name: string;
      phone: string;
      email: string | null;
      document_number: string | null;
      full_address: string | null;
      reference_point: string | null;
    } | null;
  } | null;
};

/** Busca todas as visitas das OSs informadas, para decidir onde a cobrança acontece. */
export async function fetchCollectionVisits(workOrderIds: string[]) {
  const ids = Array.from(new Set(workOrderIds.filter(Boolean)));
  const map = new Map<string, CollectionVisit[]>();
  if (!ids.length) return map;
  const { data, error } = await supabase
    .from("visits")
    .select(
      "id, work_order_id, scheduled_date, scheduled_time, status, visit_value, final_value, service_type:service_type_id ( name )",
    )
    .in("work_order_id", ids);
  if (error) return map;
  type Row = {
    id: string;
    work_order_id: string;
    scheduled_date: string;
    scheduled_time: string;
    status: string;
    visit_value: number;
    final_value: number | null;
    service_type: { name: string } | null;
  };
  for (const r of (data ?? []) as unknown as Row[]) {
    const list = map.get(r.work_order_id) ?? [];
    list.push({
      id: r.id,
      scheduled_date: r.scheduled_date,
      scheduled_time: r.scheduled_time,
      status: r.status,
      service_name: r.service_type?.name ?? null,
      amount: Number(r.final_value ?? r.visit_value ?? 0),
    });
    map.set(r.work_order_id, list);
  }
  return map;
}

export function collectionSetupFromWorkOrder(wo: VisitRow["work_order"]): CollectionSetup {
  return {
    rule: wo?.collection_rule ?? null,
    collectionVisitId: wo?.collection_visit_id ?? null,
    customInstruction: wo?.payment_instruction ?? null,
    negotiatedTotal: Number(wo?.total_gross_value ?? 0),
    paymentMethod: wo?.negotiated_payment_method ?? null,
    installments: wo?.negotiated_installments ?? 1,
  };
}

export function visitMessageContext(
  v: VisitRow,
  template?: unknown,
  siblings?: CollectionVisit[],
): string {
  const setup = collectionSetupFromWorkOrder(v.work_order);
  const lista: CollectionVisit[] =
    siblings && siblings.length
      ? siblings
      : [
          {
            id: v.id,
            scheduled_date: v.scheduled_date,
            scheduled_time: v.scheduled_time,
            status: v.status,
            service_name: v.service_type?.name ?? null,
            amount: Number(v.final_value ?? v.visit_value ?? 0),
          },
        ];
  const collection = collectionFields(v.id, lista, setup);

  return renderMessage(template, {
    weekday: weekdayPT(v.scheduled_date),
    date: dateBR(v.scheduled_date),
    time: timeBR(v.scheduled_time),
    osNumber: v.work_order?.os_number ?? "",
    customer: v.work_order?.customer?.full_name ?? "",
    phone: v.work_order?.customer?.phone ?? "",
    upholstery: v.upholstery_description || v.upholstery_type?.name || "",
    service: v.service_type?.name ?? "",
    address: v.work_order?.customer?.full_address ?? "",
    value: Number(v.final_value ?? v.visit_value ?? 0),
    technician: v.technician?.name ?? "",
    notes: v.visit_notes ?? "",
    collection,
  });
}

/** Status em que a visita conta como finalizada para o cálculo da rota (mas não para receita). */
export const TRAVEL_RESCHEDULE_STATUS = "Reagendado com deslocamento";

/**
 * Cria uma OS de reincidência vinculada à OS original: mesmo cliente, mesmo serviço,
 * itens copiados com valor zero (editáveis depois) e motivo obrigatório.
 */
export async function createRecurrenceOrder(args: {
  visitId: string;
  workOrderId: string;
  newDate: string;
  newTime: string;
  technicianId: string | null;
  reason: string;
  notes: string | null;
  userId: string | null;
}) {
  const { data: origem, error: origemError } = await supabase
    .from("work_orders")
    .select(
      "id, os_number, customer_id, sales_origin_id, salesperson_id, negotiated_payment_method",
    )
    .eq("id", args.workOrderId)
    .single();
  if (origemError) throw origemError;

  const { data: visita, error: visitaError } = await supabase
    .from("visits")
    .select("service_type_id, upholstery_type_id, upholstery_description, item_quantity")
    .eq("id", args.visitId)
    .single();
  if (visitaError) throw visitaError;

  const osNumber = `${origem.os_number}-R`;
  const numeroLivre = (await osNumberExists(osNumber))
    ? `${origem.os_number}-R${Date.now().toString().slice(-4)}`
    : osNumber;

  const { data: nova, error: novaError } = await supabase
    .from("work_orders")
    .insert({
      os_number: numeroLivre,
      customer_id: origem.customer_id,
      sale_date: args.newDate,
      sales_origin_id: origem.sales_origin_id,
      salesperson_id: origem.salesperson_id,
      total_gross_value: 0,
      items_sum: 0,
      status: "Agendada",
      commission_percentage_snapshot: 0,
      commission_expected: 0,
      os_type: "reincidencia",
      origin_work_order_id: origem.id,
      recurrence_reason: args.reason,
      recurrence_notes: args.notes,
      os_value_text: "Retorno sem cobrança",
      collection_rule: "no_on_site_collection",
      general_notes: `Reincidência da OS ${origem.os_number}. Motivo: ${args.reason}`,
      created_by: args.userId,
      updated_by: args.userId,
    } as never)
    .select("id, os_number")
    .single();
  if (novaError) throw novaError;

  const { data: novaVisita, error: visitaInsertError } = await supabase
    .from("visits")
    .insert({
      work_order_id: nova.id,
      service_type_id: visita.service_type_id,
      upholstery_type_id: visita.upholstery_type_id,
      upholstery_description: visita.upholstery_description,
      scheduled_date: args.newDate,
      scheduled_time: args.newTime,
      technician_id: args.technicianId,
      visit_value: 0,
      item_quantity: Number(visita.item_quantity ?? 1) || 1,
      visit_notes: args.notes,
      status: "Agendado",
    } as never)
    .select("id")
    .single();
  if (visitaInsertError) throw visitaInsertError;

  const { data: itens } = await supabase
    .from("service_items")
    .select("upholstery_type_id, description, quantity, item_group_id, display_order")
    .eq("visit_id", args.visitId)
    .eq("active", true);
  if (itens?.length) {
    const { error } = await supabase.from("service_items").insert(
      itens.map((i) => ({
        ...i,
        visit_id: novaVisita.id,
        unit_price: 0,
        subtotal: 0,
        active: true,
      })) as never,
    );
    if (error) throw error;
  }

  await supabase
    .from("visits")
    .update({ recurrence_work_order_id: nova.id })
    .eq("id", args.visitId);

  await logOsHistory({
    workOrderId: args.workOrderId,
    eventType: "Reincidência",
    description: `Reincidência gerada na OS ${nova.os_number} para ${dateBR(args.newDate)}. Motivo: ${args.reason}`,
    details: {
      tipo: "recurrence",
      motivo: args.reason,
      observacoes: args.notes,
      nova_os_id: nova.id,
      nova_os_numero: nova.os_number,
      nova_data: args.newDate,
    },
    userId: args.userId,
  });

  await logOsHistory({
    workOrderId: nova.id,
    eventType: "Criação",
    description: `OS de reincidência criada a partir da OS ${origem.os_number}. Motivo: ${args.reason}`,
    details: { origem_os_id: origem.id, origem_os_numero: origem.os_number },
    userId: args.userId,
  });

  await sincronizarEventoAgenda("visit", novaVisita.id);

  return { workOrderId: nova.id, osNumber: nova.os_number, visitId: novaVisita.id };
}

/**
 * Reagenda uma visita. "no_travel" move a visita; "with_travel" preserva a visita original
 * (mantendo-a na rota do dia) e cria uma nova visita vinculada.
 */
export async function rescheduleVisit(args: {
  visitId: string;
  workOrderId: string;
  type: "no_travel" | "with_travel";

  originalDate: string;
  originalTechnicianId: string | null;
  serviceTypeId: string | null;
  upholsteryTypeId?: string | null;
  newDate: string;
  newTime: string;
  technicianId: string | null;
  reason: string | null;
  notes: string | null;
  userId: string | null;
}) {
  const now = new Date().toISOString();

  if (args.type === "no_travel") {
    const { error } = await supabase
      .from("visits")
      .update({
        scheduled_date: args.newDate,
        scheduled_time: args.newTime,
        technician_id: args.technicianId,
        status: "Reagendado",
        reschedule_type: "no_travel",
        technician_travel_occurred: false,
        preserve_original_route: false,
        reschedule_reason: args.reason,
        reschedule_notes: args.notes,
        original_scheduled_date: args.originalDate,
        rescheduled_at: now,
        rescheduled_by: args.userId,
      })
      .eq("id", args.visitId);
    if (error) throw error;

    await markRouteForRecalculation(args.originalDate, args.originalTechnicianId);
    await logOsHistory({
      workOrderId: args.workOrderId,
      eventType: "Reagendamento",
      description: `Visita de ${dateBR(args.originalDate)} reagendada para ${dateBR(args.newDate)} sem deslocamento.`,
      details: {
        tipo: "no_travel",
        deslocamento: false,
        motivo: args.reason,
        data_original: args.originalDate,
        nova_data: args.newDate,
      },
      userId: args.userId,
    });
    await reagendarEventoAgenda("visit", args.visitId, args.visitId);
    return { newVisitId: null as string | null };
  }

  // Reagendamento mantendo o deslocamento: cria a nova visita vinculada.
  const { data: original, error: readError } = await supabase
    .from("visits")
    .select("*")
    .eq("id", args.visitId)
    .single();
  if (readError) throw readError;
  const o = original as Record<string, unknown>;

  const { data: nova, error: insertError } = await supabase
    .from("visits")
    .insert({
      work_order_id: args.workOrderId,
      service_type_id: args.serviceTypeId,
      upholstery_type_id: (o["upholstery_type_id"] as string | null) ?? null,
      upholstery_description: (o["upholstery_description"] as string | null) ?? null,
      scheduled_date: args.newDate,
      scheduled_time: args.newTime,
      technician_id: args.technicianId,
      visit_value: Number(o["visit_value"] ?? 0),
      item_quantity: Number(o["item_quantity"] ?? 1) || 1,
      item_unit_label: (o["item_unit_label"] as string | null) ?? null,
      visit_notes: args.notes ?? (o["visit_notes"] as string | null) ?? null,
      status: "Agendado",
      reschedule_type: "with_travel",
      rescheduled_from_visit_id: args.visitId,
      original_scheduled_date: args.originalDate,
      rescheduled_at: now,
      rescheduled_by: args.userId,
    } as never)
    .select("id")
    .single();
  if (insertError) throw insertError;
  const novaId = (nova as { id: string }).id;

  // Copia os itens de serviço, mantendo o total negociado da OS intacto.
  const { data: itens } = await supabase
    .from("service_items")
    .select(
      "upholstery_type_id, description, quantity, unit_price, subtotal, item_group_id, display_order",
    )
    .eq("visit_id", args.visitId)
    .eq("active", true);
  if (itens?.length) {
    await supabase
      .from("service_items")
      .insert(itens.map((i) => ({ ...i, visit_id: novaId, active: true })) as never);
  }

  const { error: updateError } = await supabase
    .from("visits")
    .update({
      status: TRAVEL_RESCHEDULE_STATUS,
      reschedule_type: "with_travel",
      technician_travel_occurred: true,
      preserve_original_route: true,
      rescheduled_to_visit_id: novaId,
      reschedule_reason: args.reason,
      reschedule_notes: args.notes,
      original_scheduled_date: args.originalDate,
      rescheduled_at: now,
      rescheduled_by: args.userId,
    })
    .eq("id", args.visitId);
  if (updateError) throw updateError;

  await logOsHistory({
    workOrderId: args.workOrderId,
    eventType: "Reagendamento com deslocamento",
    description: `Visita de ${dateBR(args.originalDate)} reagendada para ${dateBR(args.newDate)} com deslocamento preservado.`,
    details: {
      tipo: "with_travel",
      deslocamento: true,
      rota_original_preservada: true,
      motivo: args.reason,
      observacoes: args.notes,
      data_original: args.originalDate,
      nova_data: args.newDate,
      nova_visita_id: novaId,
    },
    userId: args.userId,
  });

  await recalcWorkOrder(args.workOrderId, args.userId);

  // A rota do dia original continua valendo (o deslocamento aconteceu).
  try {
    await sincronizarRotaDoDia({
      data: {
        date: args.originalDate,
        technicianId: args.originalTechnicianId ?? null,
        source: "automática",
      },
    });
  } catch (error) {
    console.error("Não foi possível recalcular a rota do dia original.", error);
  }

  await reagendarEventoAgenda("visit", args.visitId, novaId);

  return { newVisitId: novaId };
}

async function markRouteForRecalculation(date: string, technicianId: string | null) {
  let q = supabase
    .from("daily_routes")
    .update({ needs_recalculation: true })
    .eq("route_date", date);
  q = technicianId ? q.eq("technician_id", technicianId) : q.is("technician_id", null);
  await q;
}

/** Gera as despesas recorrentes que faltam no mês, sem duplicar. */
export async function generateRecurringExpenses(month: string) {
  const result = await syncRecurringMonth(supabase, month);
  return result.created;
}

export function todayLabel() {
  return dateBR(todayISO());
}
