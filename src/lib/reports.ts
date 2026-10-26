import { SELECT_OS_DRE } from "@/lib/consultas";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Banco } from "@/lib/banco";
import { STATUS_RECEBIDOS } from "@/lib/payments";
import { EMPRESA_HEADER } from "@/lib/empresa-ativa";
import {
  pctNaData,
  resumoNexaDaEmpresa,
  type ResumoNexaEmpresa,
  type VigenciaComissao,
} from "@/lib/comissao-nexa";
import { monthEnd, monthStart, todayISO } from "@/lib/format";
import { vendidoNoPeriodo } from "@/lib/vendido";
import { buscarOsDoPeriodo, buscarOsPorId } from "@/lib/vendido-dados";
import { alocarRecebimentos, type OsRecebido, type RevenueAllocation } from "@/lib/recebido";
import { despesaDeComissao } from "@/lib/comissoes";
import { cashPaidAmount } from "@/lib/expenses";
import { despesaDeRota } from "@/lib/dre-quilometragem";
import { fetchReceivables, saldosDaOs, type VisitRaw } from "@/lib/receivables";
import { effectiveVisitValue } from "@/lib/visit-value";
import {
  despesaDeRepasse,
  repasseDaOs,
  repasseDoRecebido,
  valorLiquido,
} from "@/lib/terceirizados";

export type CompletedVisit = {
  id: string;
  completion_date: string | null;
  scheduled_date: string;
  final_value: number | null;
  visit_value: number;
  discount_amount: number | null;
  mileage_cost_allocated: number;
  /** Repasse ao parceiro dos itens terceirizados do atendimento (soma das linhas ativas). */
  repasse_parceiro?: number | null;
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
    salesperson: { name: string; atendente_nexa?: boolean; eh_ia?: boolean } | null;
    sales_origin: { name: string } | null;
    customer: { full_name: string; document_number: string | null } | null;
    /** OS de teste: fica fora de todos os números. */
    eh_teste?: boolean;
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
  work_order: {
    id: string;
    os_number: string;
    customer: { full_name: string } | null;
    eh_teste?: boolean;
  } | null;
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
  mileage_cost_allocated, repasse_parceiro,
  upholstery_description,
  service_type:service_type_id ( name ),
  upholstery_type:upholstery_type_id ( name ),
  technician:technician_id ( name ),
  work_order:work_order_id (
    id, os_number, sale_date, customer_id, commission_percentage_snapshot, eh_teste,
    salesperson:salesperson_id ( name, atendente_nexa, eh_ia ),
    sales_origin:sales_origin_id ( name ),
    customer:customer_id ( full_name, document_number )
  )
`;

/**
 * Consulta numa empresa específica (tela da Nexa, que soma todas as empresas). Sem empresa,
 * vale a empresa ativa, como sempre. O banco só aceita empresas a que o usuário tem acesso.
 */
function naEmpresa<Q extends { setHeader(name: string, value: string): Q }>(
  q: Q,
  empresaId?: string,
): Q {
  return empresaId ? q.setHeader(EMPRESA_HEADER, empresaId) : q;
}

export async function fetchCompletedVisits(
  from: string,
  to: string,
  empresaId?: string,
  db: Banco = supabase,
) {
  const { data, error } = await naEmpresa(
    db
      .from("visits")
      .select(COMPLETED_SELECT)
      .eq("status", "Concluído")
      .gte("completion_date", from)
      .lte("completion_date", to)
      .order("completion_date"),
    empresaId,
  );
  if (error) throw error;
  return semTeste((data ?? []) as unknown as CompletedVisit[]);
}

/** OS marcadas como teste ficam fora de qualquer número. */
function semTeste<T extends { work_order: { eh_teste?: boolean } | null }>(lista: T[]): T[] {
  return lista.filter((r) => !r.work_order?.eh_teste);
}

export async function fetchPayments(
  from: string,
  to: string,
  includeInactive = false,
  db: Banco = supabase,
) {
  let q = db
    .from("payments")
    .select(
      `id, work_order_id, visit_id, payment_date, payment_channel, payment_type, installments,
       gross_amount, applied_rate, payment_fee_amount, net_amount, payment_status, notes,
       is_active, reopened_at, reopen_reason,
       work_order:work_order_id ( id, os_number, eh_teste, customer:customer_id ( full_name ) )`,
    )
    .gte("payment_date", from)
    .lte("payment_date", to)
    .order("payment_date");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return semTeste((data ?? []) as unknown as PaymentRow[]);
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
  empresaId?: string,
  db: Banco = supabase,
) {
  const completed = completedInput ?? (await fetchCompletedVisits(from, to, empresaId, db));

  const PAY_SELECT = `id, work_order_id, visit_id, payment_date, payment_channel, payment_type, installments,
       gross_amount, applied_rate, payment_fee_amount, net_amount, payment_status, notes,
       is_active, reopened_at, reopen_reason,
       work_order:work_order_id ( id, os_number, eh_teste, customer:customer_id ( full_name ) )`;

  const monthOrderIds = [
    ...new Set(completed.map((v) => v.work_order?.id).filter(Boolean)),
  ] as string[];

  const queries = [
    naEmpresa(
      db
        .from("payments")
        .select(PAY_SELECT)
        .eq("is_active", true)
        .in("payment_status", STATUS_RECEBIDOS)
        .gte("payment_date", from)
        .lte("payment_date", to),
      empresaId,
    ),
  ];
  if (monthOrderIds.length > 0) {
    queries.push(
      naEmpresa(
        db
          .from("payments")
          .select(PAY_SELECT)
          .eq("is_active", true)
          .in("payment_status", STATUS_RECEBIDOS)
          .in("work_order_id", monthOrderIds),
        empresaId,
      ),
    );
  }

  const results = await Promise.all(queries);
  for (const r of results) if (r.error) throw r.error;

  const byId = new Map<string, PaymentRow>();
  for (const r of results) {
    for (const p of (r.data ?? []) as unknown as PaymentRow[]) byId.set(p.id, p);
  }
  const candidates = semTeste([...byId.values()]);
  if (candidates.length === 0) return [];

  // Conclusões dos atendimentos das OSs envolvidas, para definir a competência.
  const orderIds = [...new Set(candidates.map((p) => p.work_order_id).filter(Boolean))] as string[];
  const { data: visitRows, error: visitErr } = await naEmpresa(
    db
      .from("visits")
      .select("id, work_order_id, completion_date")
      .eq("status", "Concluído")
      .in("work_order_id", orderIds),
    empresaId,
  );
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

export type { RevenueAllocation } from "@/lib/recebido";

export type RecebidoDoPeriodo = {
  from: string;
  to: string;
  completed: CompletedVisit[];
  payments: PaymentRow[];
  /** Um item por pagamento recebido no período (data do pagamento). */
  allocations: RevenueAllocation[];
  received: number;
  receivedNet: number;
  /** Repasse a parceiros descontado da receita (parte do que foi recebido). */
  repasse: number;
  fees: number;
  feesByChannel: Record<string, number>;
  /** Valor dos serviços concluídos no período (informativo), já sem o repasse a parceiros. */
  servicesValue: number;
  servicesCount: number;
  ordersCount: number;
  customersCount: number;
  /** Serviços concluídos no período ainda sem recebimento (saldos dispensados fora). */
  pendingValue: number;
};

const OS_RECEBIDO_SELECT = `id, empresa_id, os_number, sale_date, customer_id, total_gross_value,
  commission_percentage_snapshot, vendido_por,
  salesperson:salesperson_id ( id, name, atendente_nexa, eh_ia, commission_percentage ),
  sales_origin:sales_origin_id ( name ),
  visits!visits_work_order_id_fkey ( id, status, repasse_parceiro, service_type:service_type_id ( name ) )`;

/**
 * Base financeira única (DRE, origens, Comissão Nexa e comissões): pagamentos ativos "Pago" ou
 * "Parcialmente pago" com DATA DO PAGAMENTO no período, pelo valor recebido. A receita sai sem a
 * parte do repasse ao parceiro; a comissão usa o valor cheio. Nada que não foi recebido entra.
 */
export async function fetchRecebidoDoPeriodo(
  from: string,
  to: string,
  completedInput?: CompletedVisit[],
  empresaId?: string,
  db: Banco = supabase,
): Promise<RecebidoDoPeriodo> {
  const [completed, pagRes] = await Promise.all([
    completedInput ?? fetchCompletedVisits(from, to, empresaId, db),
    naEmpresa(
      db
        .from("payments")
        .select(
          `id, work_order_id, visit_id, payment_date, payment_channel, payment_type, installments,
           gross_amount, applied_rate, payment_fee_amount, net_amount, payment_status, notes,
           is_active, reopened_at, reopen_reason,
           work_order:work_order_id ( id, os_number, eh_teste, customer:customer_id ( full_name ) )`,
        )
        .eq("is_active", true)
        .in("payment_status", STATUS_RECEBIDOS)
        .gte("payment_date", from)
        .lte("payment_date", to)
        .order("payment_date"),
      empresaId,
    ),
  ]);
  if (pagRes.error) throw pagRes.error;
  const payments = semTeste((pagRes.data ?? []) as unknown as PaymentRow[]);

  // OS dos pagamentos (vendedora, origem, percentual, repasse).
  const osIds = [...new Set(payments.map((p) => p.work_order_id))];
  const oss = new Map<string, OsRecebido>();
  if (osIds.length) {
    // % da Nexa: o do contrato vigente na data da venda (só o admin lê os contratos; sem eles,
    // vale o % gravado na OS).
    const [{ data, error }, { data: contratos }] = await Promise.all([
      naEmpresa(db.from("work_orders").select(OS_RECEBIDO_SELECT).in("id", osIds), empresaId),
      naEmpresa(
        db
          .from("contratos_comissao")
          .select("empresa_id, percentual, vigencia_inicio, vigencia_fim"),
        empresaId,
      ),
    ]);
    if (error) throw error;
    const vigencias = (contratos ?? []) as VigenciaComissao[];
    for (const w of (data ?? []) as unknown as Array<{
      id: string;
      empresa_id: string;
      vendido_por: string | null;
      os_number: string;
      sale_date: string | null;
      customer_id: string | null;
      total_gross_value: number | null;
      commission_percentage_snapshot: number | null;
      salesperson: OsRecebido["vendedora"];
      sales_origin: { name: string } | null;
      visits: Array<{
        id: string;
        status: string;
        repasse_parceiro: number | null;
        service_type: { name: string } | null;
      }> | null;
    }>) {
      oss.set(w.id, {
        id: w.id,
        os_number: w.os_number,
        sale_date: w.sale_date,
        customer_id: w.customer_id,
        total_gross_value: w.total_gross_value,
        commission_percentage_snapshot: w.commission_percentage_snapshot,
        vendido_por: w.vendido_por,
        nexaPct: pctNaData(vigencias, w.empresa_id, w.sale_date),
        origem: w.sales_origin?.name ?? null,
        vendedora: w.salesperson,
        visitas: (w.visits ?? []).map((v) => ({
          id: v.id,
          status: v.status,
          repasse_parceiro: v.repasse_parceiro,
          servico: v.service_type?.name ?? null,
        })),
      });
    }
  }
  const allocations = alocarRecebimentos(payments, oss);

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
  const repasse = round2(allocations.reduce((s, a) => s + a.repasse, 0));

  // Informativo: serviços concluídos no período ainda em aberto (mesma conta do A receber).
  let pendingValue = 0;
  const osConcluidas = [
    ...new Set(completed.map((v) => v.work_order?.id).filter(Boolean)),
  ] as string[];
  if (osConcluidas.length) {
    const noPeriodo = new Set(completed.map((v) => v.id));
    const [lista, { data: pagos, error: pagosErr }] = await Promise.all([
      buscarOsPorId(db, osConcluidas),
      naEmpresa(
        db
          .from("payments")
          .select("work_order_id, gross_amount")
          .eq("is_active", true)
          .in("payment_status", STATUS_RECEBIDOS)
          .in("work_order_id", osConcluidas),
        empresaId,
      ),
    ]);
    if (pagosErr) throw pagosErr;
    const pagoPorOs = new Map<string, number>();
    for (const p of pagos ?? [])
      pagoPorOs.set(
        p.work_order_id as string,
        round2((pagoPorOs.get(p.work_order_id as string) ?? 0) + Number(p.gross_amount ?? 0)),
      );
    const hoje = todayISO();
    for (const os of lista) {
      const visitas = os.visitas.filter((v) => v.status !== "Cancelado") as unknown as VisitRaw[];
      for (const s of saldosDaOs(os, visitas, pagoPorOs.get(os.id) ?? 0, hoje))
        if (noPeriodo.has(s.visita.id)) pendingValue = round2(pendingValue + s.balance);
    }
  }

  const customers = new Set(
    completed.map((v) => v.work_order?.customer_id).filter(Boolean) as string[],
  );
  return {
    from,
    to,
    completed,
    payments,
    allocations,
    received,
    receivedNet,
    repasse,
    fees,
    feesByChannel,
    servicesValue: round2(
      completed.reduce((s, v) => s + valorLiquido(effectiveVisitValue(v), v.repasse_parceiro), 0),
    ),
    servicesCount: completed.length,
    ordersCount: new Set(completed.map((v) => v.work_order?.id).filter(Boolean)).size,
    customersCount: customers.size,
    pendingValue,
  };
}

export async function fetchExpenses(from: string, to: string, db: Banco = supabase) {
  const { data, error } = await db
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

export async function fetchOriginBreakdown(
  from: string,
  to: string,
  db: Banco = supabase,
): Promise<OriginBreakdown> {
  const revenue = await fetchRecebidoDoPeriodo(from, to, undefined, undefined, db);
  const rows = revenue.allocations;

  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];

  // Histórico de OSs desses clientes, para saber se já eram clientes antes.
  const history = new Map<string, string[]>();
  if (customerIds.length > 0) {
    const { data: hist, error: histErr } = await db
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
  /** Vendido do mês pela data do serviço com a parte do parceiro (o que o cliente paga). */
  soldGross: number;
  /** Vendido do mês sem o repasse a parceiros (itens terceirizados): o número principal. */
  soldNet: number;
  soldCount: number;
  completedCount: number;
  /** Receita reconhecida: pagamentos recebidos no mês (data do pagamento) menos o repasse a parceiros. */
  revenue: number;
  /** Repasse a parceiros descontado da receita (itens terceirizados). */
  repasse: number;
  /** Despesas "Repasse a parceiro" pagas no mês (fora do DRE: a receita já entra líquida). */
  repasseExpensesPaid: number;
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
  /** Parte das comissões que é paga à Nexa (vendedoras atendentes da Nexa). */
  nexa: ResumoNexaEmpresa;
  /** Comissões das demais vendedoras (da própria empresa). */
  commissionsOthers: number;
  commissionsOthersBySalesperson: Record<string, number>;
  mileage: number;
  /** Despesas de quilometragem das rotas pagas no mês (já contadas em `mileage`, fora do DRE). */
  mileageExpensesPaid: number;
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
    queryFn: () => fetchMonthSummary(from, to),
  });
}

/**
 * Resumo financeiro de um período (o DRE usa o mês): a mesma regra para a tela do DRE, as
 * Exportações e o painel do Início (que roda isto no servidor com o cliente da requisição).
 */
export async function fetchMonthSummary(
  from: string,
  to: string,
  db: Banco = supabase,
): Promise<MonthSummary> {
  const completed = await fetchCompletedVisits(from, to, undefined, db);
  const [revenueBase, expenses, soldRes, invoicesRes, cashOutRes, cmvRes, osDoMes] =
    await Promise.all([
      fetchRecebidoDoPeriodo(from, to, completed, undefined, db),
      fetchExpenses(from, to, db),
      db
        .from("work_orders")
        .select(SELECT_OS_DRE)
        .is("deleted_at", null)
        .gte("sale_date", from)
        .lte("sale_date", to),
      db
        .from("invoice_tasks")
        .select("id", { count: "exact", head: true })
        .in("status", ["Pendente", "Solicitada"]),
      db
        .from("expenses")
        .select("status, paid_amount, actual_amount")
        .is("deleted_at", null)
        .gte("payment_date", from)
        .lte("payment_date", to),
      db
        .from("os_produtos_utilizados")
        .select("custo_calculado, created_at")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
      buscarOsDoPeriodo(db, from, to),
    ]);

  const payments = revenueBase.payments;

  const vendas = (soldRes.data ?? []).filter((w) => !w.eh_teste);
  // Vendido do mês pela data do serviço (líquido do repasse; o cheio ao lado).
  const vendido = vendidoNoPeriodo(osDoMes, { de: from, ate: to }, todayISO());
  const soldGross = vendido.cheio;
  const canceled = vendas
    .filter((w) => w.status === "Cancelada")
    .reduce((s, w) => s + Number(w.total_gross_value ?? 0), 0);

  // Receita = somente o que foi efetivamente recebido (pela data do pagamento), sem o repasse a
  // parceiros dos itens terceirizados.
  const repasse = revenueBase.repasse;
  const revenue = round2(revenueBase.received - repasse);
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
    if (value === 0 && r.receivedGross === 0) continue;
    // Comissão sobre o valor CHEIO pago pelo cliente (o repasse ao parceiro não sai da base).
    const comm = round2((r.receivedGross * r.commissionPct) / 100);
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

  const nexa = resumoNexaDaEmpresa(revenueBase.allocations);

  // Custo de deslocamento dos atendimentos realizados no período.
  const mileage = round2(completed.reduce((s, v) => s + Number(v.mileage_cost_allocated ?? 0), 0));

  // DRE: competência do mês da despesa, mas só o que foi efetivamente pago.
  // Uma despesa de agosto paga em setembro entra no DRE de agosto assim que for paga.
  // A despesa "Quilometragem" das rotas (reference_key "mileage:...") paga o mesmo km que já
  // entra acima como custo de deslocamento (rateio nos serviços): fica fora daqui para o DRE
  // não contar duas vezes. O pagamento continua no caixa.
  const mileageExpensesPaid = round2(
    expenses
      .filter((e) => e.status !== "Cancelado" && !e.deleted_at && despesaDeRota(e))
      .reduce((s, e) => s + cashPaidAmount(e), 0),
  );
  // "Repasse a parceiro" também fica fora: a receita já entra líquida (sem o repasse).
  const repasseExpensesPaid = round2(
    expenses
      .filter((e) => e.status !== "Cancelado" && !e.deleted_at && despesaDeRepasse(e))
      .reduce((s, e) => s + cashPaidAmount(e), 0),
  );
  // "Comissões" lançadas em Comissões a pagar também ficam fora: a comissão já entra calculada.
  const validExpenses = expenses.filter(
    (e) =>
      e.status !== "Cancelado" &&
      !e.deleted_at &&
      !despesaDeRota(e) &&
      !despesaDeRepasse(e) &&
      !despesaDeComissao(e),
  );
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
      (s, e) => s + Math.max(0, Number(e.expected_amount ?? 0) - round2(cashPaidAmount(e))),
      0,
    ),
  );
  const expensesPending = expensesUnpaid;
  const cashOut = round2(
    (cashOutRes.data ?? []).reduce((s, e) => s + cashPaidAmount(e as unknown as ExpenseRow), 0),
  );

  // CMV: produtos consumidos nos serviços do período (custo congelado no lançamento).
  const cmv = round2((cmvRes.data ?? []).reduce((s, r) => s + Number(r.custo_calculado ?? 0), 0));

  const variableCosts = fees + commissions + mileage + cmv;
  const netProfit = revenue - variableCosts - fixedCosts;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  const receivables = await fetchReceivables(db);

  return {
    soldGross,
    soldNet: vendido.valor,
    soldCount: vendido.quantidade,
    completedCount: completed.length,
    revenue,
    repasse,
    repasseExpensesPaid,
    servicesValue: revenueBase.servicesValue,
    servicesPending: revenueBase.pendingValue,
    discounts: 0,
    canceled,
    fees,
    feesByChannel,
    commissions,
    commissionsBySalesperson,
    nexa,
    commissionsOthers: round2(commissions - nexa.comissao),
    commissionsOthersBySalesperson: Object.fromEntries(
      Object.entries(commissionsBySalesperson).filter(([k]) => !(k in nexa.porVendedora)),
    ),
    mileage,
    mileageExpensesPaid,
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
}
