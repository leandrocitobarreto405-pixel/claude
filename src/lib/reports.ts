import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { monthEnd, monthStart } from "@/lib/format";
import { cashPaidAmount } from "@/lib/expenses";
import { fetchReceivables } from "@/lib/receivables";
import { effectiveVisitValue } from "@/lib/visit-value";


export type CompletedVisit = {
  id: string;
  completion_date: string | null;
  scheduled_date: string;
  final_value: number | null;
  visit_value: number;
  discount_amount: number | null;
  mileage_cost_allocated: number;
  service_type: { name: string } | null;
  upholstery_type: { name: string } | null;
  upholstery_description: string | null;
  technician: { name: string } | null;
  work_order: {
    id: string;
    os_number: string;
    sale_date: string;
    customer_id: string | null;
    commission_percentage_snapshot: number | null;
    salesperson: { name: string } | null;
    sales_origin: { name: string } | null;
    customer: { full_name: string; document_number: string | null } | null;
  } | null;
};


export type PaymentRow = {
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
  work_order: { id: string; os_number: string; customer: { full_name: string } | null } | null;
};


export type ExpenseRow = {
  id: string;
  description: string;
  category: string;
  competence_date: string;
  due_date: string | null;
  payment_date: string | null;
  expected_amount: number;
  actual_amount: number | null;
  status: string;
  recurring_expense_id: string | null;
  notes: string | null;
  beneficiary: string | null;
  origin: string;
  paid_amount: number;
  payment_method: string | null;
  work_order_id: string | null;
  daily_route_id: string | null;
  reference_key: string | null;
  deleted_at: string | null;
  updated_at: string;
};

const COMPLETED_SELECT = `
  id, completion_date, scheduled_date, final_value, visit_value, discount_amount,
  mileage_cost_allocated,
  upholstery_description,
  service_type:service_type_id ( name ),
  upholstery_type:upholstery_type_id ( name ),
  technician:technician_id ( name ),
  work_order:work_order_id (
    id, os_number, sale_date, customer_id, commission_percentage_snapshot,
    salesperson:salesperson_id ( name ),
    sales_origin:sales_origin_id ( name ),
    customer:customer_id ( full_name, document_number )
  )
`;


export async function fetchCompletedVisits(from: string, to: string) {
  const { data, error } = await supabase
    .from("visits")
    .select(COMPLETED_SELECT)
    .eq("status", "Concluído")
    .gte("completion_date", from)
    .lte("completion_date", to)
    .order("completion_date");
  if (error) throw error;
  return (data ?? []) as unknown as CompletedVisit[];
}

export async function fetchPayments(from: string, to: string, includeInactive = false) {
  let q = supabase
    .from("payments")
    .select(
      `id, work_order_id, visit_id, payment_date, payment_channel, payment_type, installments,
       gross_amount, applied_rate, payment_fee_amount, net_amount, payment_status, notes,
       is_active, reopened_at, reopen_reason,
       work_order:work_order_id ( id, os_number, customer:customer_id ( full_name ) )`,
    )
    .gte("payment_date", from)
    .lte("payment_date", to)
    .order("payment_date");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as PaymentRow[];
}

/** Pagamentos reabertos (inativos) do período, para exibição e histórico. */
export async function fetchReopenedPayments(from: string, to: string) {
  const { data, error } = await supabase
    .from("payments")
    .select(
      `id, work_order_id, visit_id, payment_date, payment_channel, payment_type, installments,
       gross_amount, applied_rate, payment_fee_amount, net_amount, payment_status, notes,
       is_active, reopened_at, reopen_reason,
       work_order:work_order_id ( id, os_number, customer:customer_id ( full_name ) )`,
    )
    .eq("is_active", false)
    .gte("created_at", `${from}T00:00:00`)
    .lte("created_at", `${to}T23:59:59`)
    .order("reopened_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PaymentRow[];
}

/**
 * Faturamento por competência de serviço: um pagamento pertence ao mês em que o
 * atendimento foi concluído (ou o atendimento mais recente da OS). Sem nenhum
 * atendimento concluído, vale a própria data do pagamento.
 */
export async function fetchPaymentsByServiceMonth(
  from: string,
  to: string,
  completedInput?: CompletedVisit[],
) {
  const completed = completedInput ?? (await fetchCompletedVisits(from, to));

  const PAY_SELECT = `id, work_order_id, visit_id, payment_date, payment_channel, payment_type, installments,
       gross_amount, applied_rate, payment_fee_amount, net_amount, payment_status, notes,
       is_active, reopened_at, reopen_reason,
       work_order:work_order_id ( id, os_number, customer:customer_id ( full_name ) )`;

  const monthOrderIds = [...new Set(completed.map((v) => v.work_order?.id).filter(Boolean))] as string[];

  const queries = [
    supabase
      .from("payments")
      .select(PAY_SELECT)
      .eq("is_active", true)
      .eq("payment_status", "Pago")
      .gte("payment_date", from)
      .lte("payment_date", to),
  ];
  if (monthOrderIds.length > 0) {
    queries.push(
      supabase
        .from("payments")
        .select(PAY_SELECT)
        .eq("is_active", true)
        .eq("payment_status", "Pago")
        .in("work_order_id", monthOrderIds),
    );
  }

  const results = await Promise.all(queries);
  for (const r of results) if (r.error) throw r.error;

  const byId = new Map<string, PaymentRow>();
  for (const r of results) {
    for (const p of (r.data ?? []) as unknown as PaymentRow[]) byId.set(p.id, p);
  }
  const candidates = [...byId.values()];
  if (candidates.length === 0) return [];

  // Conclusões dos atendimentos das OSs envolvidas, para definir a competência.
  const orderIds = [...new Set(candidates.map((p) => p.work_order_id).filter(Boolean))] as string[];
  const { data: visitRows, error: visitErr } = await supabase
    .from("visits")
    .select("id, work_order_id, completion_date")
    .eq("status", "Concluído")
    .in("work_order_id", orderIds);
  if (visitErr) throw visitErr;

  const visitCompletion = new Map<string, string>();
  const lastOrderCompletion = new Map<string, string>();
  for (const v of visitRows ?? []) {
    const d = v.completion_date as string | null;
    if (!d) continue;
    visitCompletion.set(v.id as string, d);
    const wo = v.work_order_id as string;
    const prev = lastOrderCompletion.get(wo);
    if (!prev || d > prev) lastOrderCompletion.set(wo, d);
  }

  const inMonth = (d: string | null) => !!d && d >= from && d <= to;

  return candidates
    .filter((p) => {
      const byVisit = p.visit_id ? visitCompletion.get(p.visit_id) : undefined;
      const competence = byVisit ?? lastOrderCompletion.get(p.work_order_id) ?? p.payment_date;
      return inMonth(competence ?? null);
    })
    .sort((a, b) => (a.payment_date ?? "").localeCompare(b.payment_date ?? ""));
}

// ============== Receita reconhecida (somente o que foi recebido) ==============

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Recebimento atribuído a um atendimento concluído do período. */
export type RevenueAllocation = {
  visitId: string | null;
  workOrderId: string;
  osNumber: string;
  customerId: string | null;
  saleDate: string | null;
  origin: string;
  salesperson: string;
  service: string;
  serviceValue: number;
  discount: number;
  received: number;
  mileage: number;
  commissionPct: number;
};

export type ServiceMonthRevenue = {
  from: string;
  to: string;
  completed: CompletedVisit[];
  payments: PaymentRow[];
  allocations: RevenueAllocation[];
  received: number;
  receivedNet: number;
  fees: number;
  feesByChannel: Record<string, number>;
  servicesValue: number;
  servicesCount: number;
  ordersCount: number;
  customersCount: number;
  /** Serviços concluídos no período ainda sem recebimento (saldos dispensados fora). */
  pendingValue: number;
};

/**
 * Base financeira única: pagamentos ativos e pagos, atribuídos ao mês em que o
 * serviço foi concluído, rateados entre os atendimentos concluídos da OS.
 * Nada que não foi recebido entra como receita.
 */
export async function fetchServiceMonthRevenue(
  from: string,
  to: string,
  completedInput?: CompletedVisit[],
): Promise<ServiceMonthRevenue> {
  const completed = completedInput ?? (await fetchCompletedVisits(from, to));
  const payments = await fetchPaymentsByServiceMonth(from, to, completed);

  const orderIds = [
    ...new Set([
      ...completed.map((v) => v.work_order?.id).filter(Boolean),
      ...payments.map((p) => p.work_order_id),
    ]),
  ] as string[];

  // Atendimentos concluídos (qualquer data) das OSs envolvidas, para o rateio.
  const allCompleted = new Map<
    string,
    { id: string; work_order_id: string; completion_date: string | null; value: number; discount: number }[]
  >();
  if (orderIds.length > 0) {
    const { data, error } = await supabase
      .from("visits")
      .select("id, work_order_id, completion_date, visit_value, final_value, discount_amount")
      .eq("status", "Concluído")
      .in("work_order_id", orderIds);
    if (error) throw error;
    for (const v of data ?? []) {
      const wo = v.work_order_id as string;
      const list = allCompleted.get(wo) ?? [];
      list.push({
        id: v.id as string,
        work_order_id: wo,
        completion_date: (v.completion_date as string | null) ?? null,
        value: round2(effectiveVisitValue(v as { final_value: number | null; visit_value: number })),
        discount: round2(Math.max(0, Number(v.discount_amount ?? 0))),
      });
      allCompleted.set(wo, list);
    }
    for (const [wo, list] of allCompleted) {
      list.sort((a, b) => (a.completion_date ?? "").localeCompare(b.completion_date ?? ""));
      allCompleted.set(wo, list);
    }
  }

  // Pagamentos ativos e pagos de qualquer data, para saber o que já foi recebido.
  const paidByOrder = new Map<string, number>();
  if (orderIds.length > 0) {
    const { data, error } = await supabase
      .from("payments")
      .select("work_order_id, gross_amount")
      .eq("is_active", true)
      .eq("payment_status", "Pago")
      .in("work_order_id", orderIds);
    if (error) throw error;
    for (const p of data ?? []) {
      const wo = p.work_order_id as string;
      paidByOrder.set(wo, round2((paidByOrder.get(wo) ?? 0) + Number(p.gross_amount ?? 0)));
    }
  }

  const visitInPeriod = new Map<string, CompletedVisit>();
  const periodByOrder = new Map<string, CompletedVisit[]>();
  for (const v of completed) {
    visitInPeriod.set(v.id, v);
    const wo = v.work_order?.id;
    if (!wo) continue;
    const list = periodByOrder.get(wo) ?? [];
    list.push(v);
    periodByOrder.set(wo, list);
  }

  const base = (v: CompletedVisit) => ({
    visitId: v.id,
    workOrderId: v.work_order?.id ?? "",
    osNumber: v.work_order?.os_number ?? "",
    customerId: v.work_order?.customer_id ?? null,
    saleDate: v.work_order?.sale_date ?? null,
    origin: v.work_order?.sales_origin?.name ?? "Indefinida",
    salesperson: v.work_order?.salesperson?.name ?? "Sem vendedora",
    service: v.service_type?.name ?? "Sem serviço",
    serviceValue: round2(effectiveVisitValue(v)),
    discount: round2(Math.max(0, Number(v.discount_amount ?? 0))),
    mileage: round2(Number(v.mileage_cost_allocated ?? 0)),
    commissionPct: Number(v.work_order?.commission_percentage_snapshot ?? 0),
  });

  const allocations = new Map<string, RevenueAllocation>();
  const ensure = (v: CompletedVisit) => {
    const existing = allocations.get(v.id);
    if (existing) return existing;
    const created: RevenueAllocation = { ...base(v), received: 0 };
    allocations.set(v.id, created);
    return created;
  };
  for (const v of completed) ensure(v);

  // Pagamentos fora dos atendimentos do período (OS sem serviço concluído aqui).
  const extras = new Map<string, RevenueAllocation>();

  for (const p of payments) {
    const gross = round2(Number(p.gross_amount ?? 0));
    if (gross === 0) continue;

    const direct = p.visit_id ? visitInPeriod.get(p.visit_id) : undefined;
    if (direct) {
      ensure(direct).received = round2(ensure(direct).received + gross);
      continue;
    }

    const targets = periodByOrder.get(p.work_order_id) ?? [];
    if (targets.length > 0) {
      const totalValue = targets.reduce((s, v) => s + round2(effectiveVisitValue(v)), 0);
      let left = gross;
      targets.forEach((v, i) => {
        const share =
          i === targets.length - 1
            ? left
            : totalValue > 0
              ? round2((gross * round2(effectiveVisitValue(v))) / totalValue)
              : round2(gross / targets.length);
        left = round2(left - share);
        const row = ensure(v);
        row.received = round2(row.received + share);
      });
      continue;
    }

    const key = p.work_order_id;
    const extra =
      extras.get(key) ??
      ({
        visitId: null,
        workOrderId: p.work_order_id,
        osNumber: p.work_order?.os_number ?? "",
        customerId: null,
        saleDate: null,
        origin: "Indefinida",
        salesperson: "Sem vendedora",
        service: "Sem serviço",
        serviceValue: 0,
        discount: 0,
        received: 0,
        mileage: 0,
        commissionPct: 0,
      } satisfies RevenueAllocation);
    extra.received = round2(extra.received + gross);
    extras.set(key, extra);
  }

  // Origem/vendedora dos pagamentos sem atendimento concluído no período.
  if (extras.size > 0) {
    const { data, error } = await supabase
      .from("work_orders")
      .select(
        `id, os_number, sale_date, customer_id,
         salesperson:salesperson_id ( name ),
         sales_origin:sales_origin_id ( name )`,
      )
      .in("id", [...extras.keys()]);
    if (error) throw error;
    for (const w of data ?? []) {
      const row = extras.get(w.id as string);
      if (!row) continue;
      const origin = (w as { sales_origin?: { name?: string } | null }).sales_origin?.name;
      const seller = (w as { salesperson?: { name?: string } | null }).salesperson?.name;
      row.origin = origin ?? "Indefinida";
      row.salesperson = seller ?? "Sem vendedora";
      row.customerId = (w.customer_id as string | null) ?? null;
      row.saleDate = (w.sale_date as string | null) ?? null;
      row.osNumber = (w.os_number as string) ?? row.osNumber;
    }
  }

  // Pendente: valor dos serviços do período ainda sem recebimento, abatendo dispensas.
  let pendingValue = 0;
  for (const [wo, list] of allCompleted) {
    let left = paidByOrder.get(wo) ?? 0;
    for (const v of list) {
      const paid = round2(Math.min(v.value, Math.max(0, left)));
      left = round2(left - paid);
      if (!visitInPeriod.has(v.id)) continue;
      pendingValue = round2(pendingValue + Math.max(0, round2(v.value - paid - v.discount)));
    }
  }

  const feesByChannel: Record<string, number> = {};
  let fees = 0;
  let received = 0;
  let receivedNet = 0;
  for (const p of payments) {
    fees = round2(fees + Number(p.payment_fee_amount ?? 0));
    received = round2(received + Number(p.gross_amount ?? 0));
    receivedNet = round2(receivedNet + Number(p.net_amount ?? 0));
    feesByChannel[p.payment_channel] = round2(
      (feesByChannel[p.payment_channel] ?? 0) + Number(p.payment_fee_amount ?? 0),
    );
  }

  const rows = [...allocations.values(), ...extras.values()];
  const customers = new Set(
    completed.map((v) => v.work_order?.customer_id).filter(Boolean) as string[],
  );

  return {
    from,
    to,
    completed,
    payments,
    allocations: rows,
    received,
    receivedNet,
    fees,
    feesByChannel,
    servicesValue: round2(completed.reduce((s, v) => s + effectiveVisitValue(v), 0)),
    servicesCount: completed.length,
    ordersCount: new Set(completed.map((v) => v.work_order?.id).filter(Boolean)).size,
    customersCount: customers.size,
    pendingValue,
  };
}


export async function fetchExpenses(from: string, to: string) {
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .is("deleted_at", null)
    .gte("competence_date", from)
    .lte("competence_date", to)
    .order("due_date");
  if (error) throw error;
  return (data ?? []) as unknown as ExpenseRow[];
}

// ===================== Origens da venda x recorrência =====================

export type OriginStat = {
  origin: string;
  customers: number;
  services: number;
  revenue: number;
  ticket: number;
  share: number;
};

export type OriginBreakdown = {
  /** Receita: somente pagamentos recebidos dos serviços do período. */
  total: number;
  /** Valor dos serviços concluídos no período, recebidos ou não. */
  servicesValue: number;
  /** Diferença entre serviços realizados e recebido (fica em "A receber"). */
  pending: number;
  totalServices: number;
  totalOrders: number;
  totalCustomers: number;
  totalPayments: number;
  byOrigin: OriginStat[];
  byRecurrence: OriginStat[];
  cross: { origin: string; novo: number; recorrente: number; total: number }[];
};

export async function fetchOriginBreakdown(from: string, to: string): Promise<OriginBreakdown> {
  const revenue = await fetchServiceMonthRevenue(from, to);
  const rows = revenue.allocations;

  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];

  // Histórico de OSs desses clientes, para saber se já eram clientes antes.
  const history = new Map<string, string[]>();
  if (customerIds.length > 0) {
    const { data: hist, error: histErr } = await supabase
      .from("work_orders")
      .select("id, customer_id, sale_date")
      .is("deleted_at", null)
      .in("customer_id", customerIds);
    if (histErr) throw histErr;
    for (const w of hist ?? []) {
      const cid = w.customer_id as string;
      const list = history.get(cid) ?? [];
      list.push(w.sale_date as string);
      history.set(cid, list);
    }
  }

  type Acc = { revenue: number; services: number; customers: Set<string> };
  const mk = (): Acc => ({ revenue: 0, services: 0, customers: new Set<string>() });
  const byOrigin = new Map<string, Acc>();
  const byRec = new Map<string, Acc>();
  const cross = new Map<string, { novo: number; recorrente: number }>();
  const allCustomers = new Set<string>();
  let total = 0;

  for (const r of rows) {
    const value = r.received;
    if (value === 0) continue;
    const origin = r.origin;
    const previous =
      !!r.customerId &&
      !!r.saleDate &&
      (history.get(r.customerId) ?? []).some((d) => d < r.saleDate!);
    const rec = previous ? "Cliente recorrente" : "Cliente novo";

    total += value;
    if (r.customerId) allCustomers.add(r.customerId);

    const o = byOrigin.get(origin) ?? mk();
    o.revenue += value;
    o.services += 1;
    if (r.customerId) o.customers.add(r.customerId);
    byOrigin.set(origin, o);

    const rr = byRec.get(rec) ?? mk();
    rr.revenue += value;
    rr.services += 1;
    if (r.customerId) rr.customers.add(r.customerId);
    byRec.set(rec, rr);

    const c = cross.get(origin) ?? { novo: 0, recorrente: 0 };
    if (previous) c.recorrente += value;
    else c.novo += value;
    cross.set(origin, c);
  }

  const toStats = (m: Map<string, Acc>): OriginStat[] =>
    [...m.entries()]
      .map(([origin, a]) => ({
        origin,
        customers: a.customers.size,
        services: a.services,
        revenue: round2(a.revenue),
        ticket: a.customers.size > 0 ? round2(a.revenue / a.customers.size) : 0,
        share: total > 0 ? (a.revenue / total) * 100 : 0,
      }))
      .sort((x, y) => y.revenue - x.revenue);

  return {
    total: round2(total),
    servicesValue: revenue.servicesValue,
    pending: revenue.pendingValue,
    totalServices: revenue.servicesCount,
    totalOrders: revenue.ordersCount,
    totalCustomers: allCustomers.size > 0 ? allCustomers.size : revenue.customersCount,
    totalPayments: revenue.payments.length,
    byOrigin: toStats(byOrigin),
    byRecurrence: toStats(byRec),
    cross: [...cross.entries()]
      .map(([origin, c]) => ({
        origin,
        novo: round2(c.novo),
        recorrente: round2(c.recorrente),
        total: round2(c.novo + c.recorrente),
      }))
      .sort((a, b) => b.total - a.total),
  };
}


export function useOriginBreakdown(from: string, to: string) {
  return useQuery({
    queryKey: ["origin_breakdown", from, to],
    queryFn: () => fetchOriginBreakdown(from, to),
  });
}



export type MonthSummary = {
  soldGross: number;
  soldCount: number;
  completedCount: number;
  /** Receita reconhecida: somente pagamentos recebidos (competência do serviço). */
  revenue: number;
  /** Valor dos serviços concluídos no mês, recebidos ou não. */
  servicesValue: number;
  /** Serviços do mês ainda não recebidos (fica em "A receber"). */
  servicesPending: number;
  discounts: number;
  canceled: number;
  fees: number;
  feesByChannel: Record<string, number>;
  commissions: number;
  commissionsBySalesperson: Record<string, number>;
  mileage: number;
  cmv: number;
  variableCosts: number;
  fixedCosts: number;
  netProfit: number;
  netMargin: number;
  received: number;
  receivedNet: number;
  receivable: number;
  receivableScheduled: number;
  receivableCompleted: number;

  expensesPaid: number;
  expensesPending: number;
  cashResult: number;
  pendingInvoices: number;
  revenueByOrigin: Record<string, number>;
  revenueBySalesperson: Record<string, number>;
  revenueByService: Record<string, number>;
  completed: CompletedVisit[];
  payments: PaymentRow[];
  expenses: ExpenseRow[];
  /** Despesas da competência do mês que já foram pagas (mesmo pagas depois). */
  expensesPaidList: { expense: ExpenseRow; paid: number }[];
  expensesPaidByCategory: Record<string, number>;
  /** Saldo ainda não pago das despesas do mês (fora do resultado). */
  expensesUnpaid: number;
  /** Desembolso de caixa no mês, pela data do pagamento. */
  cashOut: number;

};

export function useMonthSummary(month: string) {
  const from = monthStart(month);
  const to = monthEnd(month);

  return useQuery({
    queryKey: ["month_summary", from, to],
    queryFn: async (): Promise<MonthSummary> => {
      const completed = await fetchCompletedVisits(from, to);
      const [revenueBase, expenses, soldRes, invoicesRes, cashOutRes, cmvRes] = await Promise.all([
        fetchServiceMonthRevenue(from, to, completed),
        fetchExpenses(from, to),
        supabase
          .from("work_orders")
          .select("id, total_gross_value, status")
          .gte("sale_date", from)
          .lte("sale_date", to),
        supabase.from("invoice_tasks").select("id", { count: "exact", head: true }).eq("status", "Pendente"),
        supabase
          .from("expenses")
          .select("status, paid_amount, actual_amount")
          .is("deleted_at", null)
          .gte("payment_date", from)
          .lte("payment_date", to),
        supabase
          .from("os_produtos_utilizados")
          .select("custo_calculado, created_at")
          .gte("created_at", `${from}T00:00:00`)
          .lte("created_at", `${to}T23:59:59`),
      ]);


      const payments = revenueBase.payments;

      const soldRows = (soldRes.data ?? []).filter((w) => w.status !== "Cancelada");
      const soldGross = soldRows.reduce((s, w) => s + Number(w.total_gross_value ?? 0), 0);
      const canceled = (soldRes.data ?? [])
        .filter((w) => w.status === "Cancelada")
        .reduce((s, w) => s + Number(w.total_gross_value ?? 0), 0);

      // Receita = somente o que foi efetivamente recebido (competência do serviço).
      const revenue = revenueBase.received;
      const received = revenueBase.received;
      const receivedNet = revenueBase.receivedNet;
      const fees = revenueBase.fees;
      const feesByChannel = revenueBase.feesByChannel;

      const commissionsBySalesperson: Record<string, number> = {};
      const revenueByOrigin: Record<string, number> = {};
      const revenueBySalesperson: Record<string, number> = {};
      const revenueByService: Record<string, number> = {};
      let commissions = 0;

      for (const r of revenueBase.allocations) {
        const value = r.received;
        if (value === 0) continue;
        const comm = round2((value * r.commissionPct) / 100);
        commissions = round2(commissions + comm);
        commissionsBySalesperson[r.salesperson] = round2(
          (commissionsBySalesperson[r.salesperson] ?? 0) + comm,
        );
        revenueBySalesperson[r.salesperson] = round2(
          (revenueBySalesperson[r.salesperson] ?? 0) + value,
        );
        revenueByOrigin[r.origin] = round2((revenueByOrigin[r.origin] ?? 0) + value);
        revenueByService[r.service] = round2((revenueByService[r.service] ?? 0) + value);
      }

      // Custo de deslocamento dos atendimentos realizados no período.
      const mileage = round2(
        completed.reduce((s, v) => s + Number(v.mileage_cost_allocated ?? 0), 0),
      );

      // DRE: competência do mês da despesa, mas só o que foi efetivamente pago.
      // Uma despesa de agosto paga em setembro entra no DRE de agosto assim que for paga.
      const validExpenses = expenses.filter((e) => e.status !== "Cancelado" && !e.deleted_at);
      const expensesPaidList = validExpenses
        .map((e) => ({ expense: e, paid: round2(cashPaidAmount(e)) }))
        .filter((r) => r.paid > 0)
        .sort((a, b) => b.paid - a.paid);
      const expensesPaidByCategory: Record<string, number> = {};
      for (const r of expensesPaidList) {
        expensesPaidByCategory[r.expense.category] = round2(
          (expensesPaidByCategory[r.expense.category] ?? 0) + r.paid,
        );
      }
      const fixedCosts = round2(expensesPaidList.reduce((s, r) => s + r.paid, 0));
      const expensesPaid = fixedCosts;
      const expensesUnpaid = round2(
        validExpenses.reduce(
          (s, e) =>
            s + Math.max(0, Number(e.expected_amount ?? 0) - round2(cashPaidAmount(e))),
          0,
        ),
      );
      const expensesPending = expensesUnpaid;
      const cashOut = round2(
        (cashOutRes.data ?? []).reduce(
          (s, e) => s + cashPaidAmount(e as unknown as ExpenseRow),
          0,
        ),
      );



      // CMV: produtos consumidos nos serviços do período (custo congelado no lançamento).
      const cmv = round2(
        (cmvRes.data ?? []).reduce((s, r) => s + Number(r.custo_calculado ?? 0), 0),
      );

      const variableCosts = fees + commissions + mileage + cmv;
      const netProfit = revenue - variableCosts - fixedCosts;
      const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;


      const receivables = await fetchReceivables();

      return {
        soldGross,
        soldCount: soldRows.length,
        completedCount: completed.length,
        revenue,
        servicesValue: revenueBase.servicesValue,
        servicesPending: revenueBase.pendingValue,
        discounts: 0,
        canceled,
        fees,
        feesByChannel,
        commissions,
        commissionsBySalesperson,
        mileage,
        cmv,
        variableCosts,
        fixedCosts,
        netProfit,
        netMargin,
        received,
        receivedNet: Math.round(receivedNet * 100) / 100,
        receivable: receivables.total,
        receivableScheduled: receivables.scheduled,
        receivableCompleted: receivables.completed,

        expensesPaid,
        expensesPending,
        cashResult: round2(received - cashOut),
        pendingInvoices: invoicesRes.count ?? 0,
        revenueByOrigin,
        revenueBySalesperson,
        revenueByService,
        completed,
        payments,
        expenses,
        expensesPaidList,
        expensesPaidByCategory,
        expensesUnpaid,
        cashOut,
      };
    },
  });
}
