import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { calculateDayRoute } from "./route-calc.server";
import { monthEnd, monthStart } from "./format";

type DB = SupabaseClient<Database>;

/**
 * Status finalizados para efeito de cálculo de rota. "Reagendado com deslocamento"
 * conta o deslocamento realizado, mas nunca é receita nem serviço concluído.
 */
export const ROUTE_FINALIZED_STATUSES = [
  "Concluído",
  "Reagendado com deslocamento",
  "Cancelado após deslocamento",
];

export const ACTIVE_PENDING_STATUSES = [
  "Agendado",
  "Confirmado",
  "Em deslocamento",
  "Em execução",
  "Reagendado",
];

/** Status das visitas de orçamento equivalentes a pendente e a deslocamento realizado. */
export const BUDGET_PENDING_STATUSES = [
  "Agendado",
  "Confirmado",
  "Em deslocamento",
  "Reagendado",
];

export const BUDGET_FINALIZED_STATUSES = ["Realizado"];

export type RouteSyncResult = {
  status:
    | "Aguardando conclusão dos serviços"
    | "Calculada"
    | "Aguardando custo por km"
    | "Custo gerado"
    | "Erro no cálculo"
    | "Sem serviços";
  pendentes: number;
  concluidos: number;
  km: number;
  costPerKm: number;
  totalCost: number;
  allocatedPerService: number;
  routeId: string | null;
  expenseId: string | null;
  financialDifference: boolean;
  paidAmount: number | null;
  message: string;
  failures: string[];
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function dateBRShort(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

async function findRoute(db: DB, date: string, technicianId: string | null) {
  let q = db.from("daily_routes").select("*").eq("route_date", date);
  q = technicianId ? q.eq("technician_id", technicianId) : q.is("technician_id", null);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function saveRoute(
  db: DB,
  date: string,
  technicianId: string | null,
  payload: Record<string, unknown>,
) {
  const existing = await findRoute(db, date, technicianId);
  if (existing?.id) {
    const { error } = await db
      .from("daily_routes")
      .update(payload as never)
      .eq("id", existing.id);
    if (error) throw error;
    return { id: existing.id, previous: existing };
  }
  const { data, error } = await db
    .from("daily_routes")
    .insert({ route_date: date, technician_id: technicianId, ...payload } as never)
    .select("id")
    .single();
  if (error) throw error;
  return { id: (data as { id: string }).id, previous: null };
}

/**
 * Verifica se o dia do técnico está totalmente concluído e, em caso positivo,
 * calcula a rota e rateia o custo entre as OSs. Por padrão NÃO cria despesa:
 * a cobrança da quilometragem é consolidada uma vez por mês
 * (ver `closeMonthlyMileage`). É idempotente: pode rodar várias vezes.
 */
export async function syncDailyRoute(
  db: DB,
  input: {
    date: string;
    technicianId: string | null;
    source?: "automática" | "manual";
    createExpense?: boolean;
  },
): Promise<RouteSyncResult> {
  const source = input.source ?? "automática";
  const createExpense = input.createExpense === true;

  const base: RouteSyncResult = {
    status: "Sem serviços",
    pendentes: 0,
    concluidos: 0,
    km: 0,
    costPerKm: 0,
    totalCost: 0,
    allocatedPerService: 0,
    routeId: null,
    expenseId: null,
    financialDifference: false,
    paidAmount: null,
    message: "",
    failures: [],
  };

  // 1) Serviços do dia para o técnico
  let visitQuery = db
    .from("visits")
    .select("id, status, scheduled_time, work_order_id, work_order:work_orders!visits_work_order_id_fkey(deleted_at, status)")
    .eq("scheduled_date", input.date)
    .order("scheduled_time");
  visitQuery = input.technicianId
    ? visitQuery.eq("technician_id", input.technicianId)
    : visitQuery.is("technician_id", null);
  const { data: visitRows, error: visitError } = await visitQuery;
  if (visitError) throw visitError;

  type Row = {
    id: string;
    status: string;
    work_order_id: string;
    work_order: { deleted_at: string | null; status: string } | null;
  };
  const visits = ((visitRows ?? []) as unknown as Row[]).filter(
    (v) => !v.work_order?.deleted_at && v.work_order?.status !== "Cancelada" && v.status !== "Cancelado",
  );

  // 1b) Visitas de orçamento do dia (sem OS) participam da rota e do rateio
  let budgetQuery = db
    .from("budget_visits")
    .select("id, status, scheduled_time")
    .eq("scheduled_date", input.date)
    .neq("status", "Cancelado")
    .order("scheduled_time");
  budgetQuery = input.technicianId
    ? budgetQuery.eq("technician_id", input.technicianId)
    : budgetQuery.is("technician_id", null);
  const { data: budgetRows, error: budgetError } = await budgetQuery;
  if (budgetError) throw budgetError;
  const budgets = (budgetRows ?? []) as unknown as Array<{ id: string; status: string }>;

  type Stop = { id: string; status: string; workOrderId: string | null; budget: boolean };
  const stops: Stop[] = [
    ...visits.map<Stop>((v) => ({
      id: v.id,
      status: v.status,
      workOrderId: v.work_order_id,
      budget: false,
    })),
    ...budgets.map<Stop>((b) => ({ id: b.id, status: b.status, workOrderId: null, budget: true })),
  ];

  const pendentes = stops.filter((v) =>
    v.budget ? BUDGET_PENDING_STATUSES.includes(v.status) : ACTIVE_PENDING_STATUSES.includes(v.status),
  );
  const concluidos = stops.filter((v) =>
    v.budget ? BUDGET_FINALIZED_STATUSES.includes(v.status) : ROUTE_FINALIZED_STATUSES.includes(v.status),
  );

  if (!stops.length) {
    return { ...base, message: "Nenhum serviço ativo neste dia." };
  }

  if (pendentes.length > 0) {
    const saved = await saveRoute(db, input.date, input.technicianId, {
      route_status: "Aguardando conclusão dos serviços",
      calculation_source: source,
      needs_recalculation: true,
    });
    return {
      ...base,
      status: "Aguardando conclusão dos serviços",
      pendentes: pendentes.length,
      concluidos: concluidos.length,
      routeId: saved.id,
      message: `Ainda há ${pendentes.length} serviço(s) ativo(s) neste dia. A rota será gerada quando todos estiverem concluídos.`,
    };
  }

  // 2) Cálculo do trajeto
  const calc = await calculateDayRoute(db, { date: input.date, technicianId: input.technicianId });
  const failures = calc.failures ?? [];

  const { data: setting } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "cost_per_km")
    .maybeSingle();
  const costPerKm = Number((setting?.value as number | null) ?? 0);

  const existingRoute = await findRoute(db, input.date, input.technicianId);
  const manualKm = Number(existingRoute?.real_km ?? 0);
  const km = round2(calc.totalKm > 0 ? calc.totalKm : manualKm);

  if (km <= 0) {
    const saved = await saveRoute(db, input.date, input.technicianId, {
      route_status: "Erro no cálculo",
      calculation_source: source,
      base_address: calc.baseAddress,
      needs_recalculation: true,
      calculated_at: new Date().toISOString(),
      error_message: failures.join(" · ") || "Não foi possível calcular a rota automaticamente.",
    });
    return {
      ...base,
      status: "Erro no cálculo",
      concluidos: concluidos.length,
      routeId: saved.id,
      failures,
      message: "Não foi possível calcular a rota automaticamente.",
    };
  }

  const totalCost = round2(km * costPerKm);
  const segments = calc.legs.map((l) => ({ from: l.from, to: l.to, km: l.km, minutes: l.minutes }));

  const routeStatus = costPerKm > 0 ? "Custo gerado" : "Aguardando custo por km";

  const saved = await saveRoute(db, input.date, input.technicianId, {
    route_status: routeStatus,
    calculation_source: source,
    base_address: calc.baseAddress,
    calculated_km: km,
    estimated_minutes: calc.totalMinutes,
    cost_per_km: costPerKm,
    total_cost: totalCost,
    allocation_method: "divisao_igual",
    segments: segments as never,
    needs_recalculation: false,
    calculated_at: new Date().toISOString(),
    error_message: null,
  });
  const routeId = saved.id;

  // 3) Rateio entre os serviços concluídos (divisão igual)
  const n = concluidos.length;
  let perService = 0;
  if (n > 0 && totalCost > 0) {
    perService = round2(totalCost / n);
    const kmPer = round2(km / n);
    let acumulado = 0;
    await db.from("route_cost_allocations").delete().eq("route_id", routeId);
    const rows = concluidos.map((v, i) => {
      const isLast = i === n - 1;
      const cost = isLast ? round2(totalCost - acumulado) : perService;
      if (!isLast) acumulado = round2(acumulado + perService);
      return {
        route_id: routeId,
        work_order_id: v.workOrderId,
        service_id: v.budget ? null : v.id,
        budget_visit_id: v.budget ? v.id : null,
        allocated_kilometers: kmPer,
        allocated_cost: cost,
        allocation_method: "divisao_igual",
      };
    });
    const { error: allocError } = await db.from("route_cost_allocations").insert(rows as never);
    if (allocError) throw allocError;
    for (const r of rows) {
      if (r.budget_visit_id) {
        await db
          .from("budget_visits")
          .update({ mileage_cost_allocated: r.allocated_cost })
          .eq("id", r.budget_visit_id);
      } else if (r.service_id) {
        await db.from("visits").update({ mileage_cost_allocated: r.allocated_cost }).eq("id", r.service_id);
      }
    }
  }

  if (costPerKm <= 0) {
    return {
      ...base,
      status: "Aguardando custo por km",
      concluidos: n,
      km,
      costPerKm,
      routeId,
      failures,
      message: "Rota calculada, mas o custo por km ainda não foi configurado.",
    };
  }

  if (!createExpense) {
    return {
      ...base,
      status: "Custo gerado",
      concluidos: n,
      km,
      costPerKm,
      totalCost,
      allocatedPerService: perService,
      routeId,
      failures,
      message:
        "Rota calculada e custo rateado. A despesa de quilometragem é gerada no fechamento do mês.",
    };
  }

  // 4) Despesa única do dia (idempotente por técnico + data)

  const { data: tech } = input.technicianId
    ? await db.from("technicians").select("name").eq("id", input.technicianId).maybeSingle()
    : { data: null };
  const nomeTecnico = tech?.name ?? "Equipe";
  const referenceKey = `mileage:${input.technicianId ?? "equipe"}:${input.date}`;
  const descricao = `Quilometragem ${nomeTecnico} — ${dateBRShort(input.date)}`;
  const observacao = `${km.toFixed(1).replace(".", ",")} km × R$ ${costPerKm
    .toFixed(2)
    .replace(".", ",")}/km · ${n} atendimento(s) finalizado(s)`;

  const { data: despesa } = await db
    .from("expenses")
    .select("id, status, paid_amount, actual_amount, expected_amount")
    .eq("reference_key", referenceKey)
    .is("deleted_at", null)
    .maybeSingle();

  let expenseId = despesa?.id ?? null;
  let financialDifference = false;
  let paidAmount: number | null = null;

  if (despesa?.id) {
    const jaPago = Number(despesa.paid_amount ?? despesa.actual_amount ?? 0) > 0 || despesa.status === "Pago";
    if (jaPago) {
      paidAmount = Number(despesa.paid_amount ?? despesa.actual_amount ?? 0);
      financialDifference = round2(paidAmount) !== totalCost;
      await db
        .from("expenses")
        .update({ notes: observacao, daily_route_id: routeId })
        .eq("id", despesa.id);
    } else {
      const { error } = await db
        .from("expenses")
        .update({
          description: descricao,
          category: "Quilometragem",
          beneficiary: nomeTecnico,
          origin: "Rota automática",
          competence_date: input.date,
          due_date: input.date,
          expected_amount: totalCost,
          actual_amount: null,
          paid_amount: 0,
          payment_date: null,
          status: "Pendente",
          notes: observacao,
          daily_route_id: routeId,
        })
        .eq("id", despesa.id);
      if (error) throw error;
    }
  } else {
    const { data: created, error } = await db
      .from("expenses")
      .insert({
        description: descricao,
        category: "Quilometragem",
        beneficiary: nomeTecnico,
        origin: "Rota automática",
        competence_date: input.date,
        due_date: input.date,
        expected_amount: totalCost,
        actual_amount: null,
        paid_amount: 0,
        payment_date: null,
        status: "Pendente",
        notes: observacao,
        daily_route_id: routeId,
        reference_key: referenceKey,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    expenseId = (created as { id: string }).id;
  }

  await db
    .from("daily_routes")
    .update({
      expense_id: expenseId,
      financial_difference: financialDifference,
      paid_amount_snapshot: paidAmount,
    })
    .eq("id", routeId);

  return {
    status: "Custo gerado",
    pendentes: 0,
    concluidos: n,
    km,
    costPerKm,
    totalCost,
    allocatedPerService: perService,
    routeId,
    expenseId,
    financialDifference,
    paidAmount,
    failures,
    message: financialDifference
      ? "A rota foi alterada após o pagamento da despesa."
      : `Rota calculada e despesa de quilometragem lançada como pendente.`,
  };
}

export type DailyClosingResult = {
  date: string;
  techniciansProcessed: number;
  routesCreated: number;
  routesUpdated: number;
  routesSkipped: number;
  expensesCreated: number;
  expensesUpdated: number;
  errors: string[];
  results: Array<{ technicianId: string | null; technicianName: string; status: string; message: string }>;
};

/**
 * Fechamento automático do dia: percorre todos os técnicos com atendimentos na data
 * e sincroniza a rota + despesa de quilometragem. Idempotente por técnico + data.
 */
export async function closeDailyRoutes(db: DB, date: string): Promise<DailyClosingResult> {
  const out: DailyClosingResult = {
    date,
    techniciansProcessed: 0,
    routesCreated: 0,
    routesUpdated: 0,
    routesSkipped: 0,
    expensesCreated: 0,
    expensesUpdated: 0,
    errors: [],
    results: [],
  };

  const { data: jobRun } = await db
    .from("job_runs")
    .insert({ job_name: "fechamento-rotas-diario", reference_date: date } as never)
    .select("id")
    .single();
  const jobId = (jobRun as { id: string } | null)?.id ?? null;

  const { data: visitRows, error: visitError } = await db
    .from("visits")
    .select("technician_id")
    .eq("scheduled_date", date);
  if (visitError) throw visitError;

  const { data: budgetDayRows } = await db
    .from("budget_visits")
    .select("technician_id")
    .eq("scheduled_date", date)
    .neq("status", "Cancelado");

  const ids = Array.from(
    new Set(
      [
        ...((visitRows ?? []) as Array<{ technician_id: string | null }>),
        ...((budgetDayRows ?? []) as Array<{ technician_id: string | null }>),
      ].map((v) => v.technician_id),
    ),
  );

  const { data: techRows } = await db.from("technicians").select("id, name");
  const nameById = new Map(
    ((techRows ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  );

  for (const technicianId of ids) {
    const technicianName = technicianId ? (nameById.get(technicianId) ?? "Técnico") : "Sem técnico";
    try {
      const before = await findRoute(db, date, technicianId);
      const beforeExpenseId = before?.expense_id ?? null;
      const res = await syncDailyRoute(db, { date, technicianId, source: "automática" });
      out.techniciansProcessed += 1;
      if (!before) out.routesCreated += 1;
      else out.routesUpdated += 1;
      if (res.status === "Aguardando conclusão dos serviços" || res.status === "Sem serviços") {
        out.routesSkipped += 1;
      }
      if (res.expenseId && !beforeExpenseId) out.expensesCreated += 1;
      else if (res.expenseId) out.expensesUpdated += 1;
      out.results.push({
        technicianId,
        technicianName,
        status: res.status,
        message: res.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      out.errors.push(`${technicianName}: ${message}`);
      out.results.push({
        technicianId,
        technicianName,
        status: "Erro no cálculo",
        message: "Não foi possível calcular a rota automaticamente.",
      });
    }
  }

  const nowIso = new Date().toISOString();
  if (jobId) {
    await db
      .from("job_runs")
      .update({
        finished_at: nowIso,
        status: out.errors.length ? "Concluído com erros" : "Concluído",
        technicians_processed: out.techniciansProcessed,
        routes_created: out.routesCreated,
        routes_updated: out.routesUpdated,
        routes_skipped: out.routesSkipped,
        expenses_created: out.expensesCreated,
        expenses_updated: out.expensesUpdated,
        errors: out.errors as never,
        details: { results: out.results } as never,
      })
      .eq("id", jobId);
  }

  for (const technicianId of ids) {
    const q = db.from("daily_routes").update({ last_auto_sync_at: nowIso }).eq("route_date", date);
    await (technicianId ? q.eq("technician_id", technicianId) : q.is("technician_id", null));
  }

  // Reprocessa dias anteriores que ficaram com erro (ex.: endereço não localizado).
  try {
    const retry = await retryFailedRoutes(db, { days: 45, limit: 15, before: date });
    out.results.push(...retry.results);
    out.errors.push(...retry.errors);
  } catch (error) {
    out.errors.push(error instanceof Error ? error.message : String(error));
  }

  return out;
}

export type RetryFailedRoutesResult = {
  attempted: number;
  fixed: number;
  stillFailing: number;
  errors: string[];
  results: Array<{ technicianId: string | null; technicianName: string; status: string; message: string }>;
};

/**
 * Tenta novamente as rotas que ficaram com "Erro no cálculo" e seguem marcadas
 * para recalcular. Útil quando a falha foi só na leitura do endereço no mapa.
 */
export async function retryFailedRoutes(
  db: DB,
  input?: { days?: number; limit?: number; before?: string },
): Promise<RetryFailedRoutesResult> {
  const days = input?.days ?? 45;
  const limit = input?.limit ?? 15;
  const out: RetryFailedRoutesResult = { attempted: 0, fixed: 0, stillFailing: 0, errors: [], results: [] };

  const reference = input?.before ? new Date(`${input.before}T00:00:00Z`) : new Date();
  const fromDate = new Date(reference.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let q = db
    .from("daily_routes")
    .select("route_date, technician_id")
    .eq("route_status", "Erro no cálculo")
    .eq("needs_recalculation", true)
    .gte("route_date", fromDate)
    .order("route_date", { ascending: false })
    .limit(limit);
  if (input?.before) q = q.lte("route_date", input.before);
  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as Array<{ route_date: string; technician_id: string | null }>;
  if (!rows.length) return out;

  const { data: techRows } = await db.from("technicians").select("id, name");
  const nameById = new Map(
    ((techRows ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  );

  for (const row of rows) {
    const technicianName = row.technician_id
      ? (nameById.get(row.technician_id) ?? "Técnico")
      : "Sem técnico";
    out.attempted += 1;
    try {
      const res = await syncDailyRoute(db, {
        date: row.route_date,
        technicianId: row.technician_id,
        source: "automática",
      });
      if (res.status === "Erro no cálculo") out.stillFailing += 1;
      else out.fixed += 1;
      out.results.push({
        technicianId: row.technician_id,
        technicianName: `${technicianName} (${row.route_date})`,
        status: res.status,
        message: res.message,
      });
    } catch (err) {
      out.stillFailing += 1;
      out.errors.push(`${technicianName} (${row.route_date}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return out;
}


export type MonthlyMileageTechnicianResult = {
  technicianId: string | null;
  technicianName: string;
  days: Array<{ date: string; km: number; cost: number; status: string }>;
  totalKm: number;
  totalCost: number;
  alreadyPaid: number;
  amountDue: number;
  expenseId: string | null;
  canceledDailyExpenses: number;
  financialDifference: boolean;
  message: string;
};

export type MonthlyMileageResult = {
  month: string;
  technicians: MonthlyMileageTechnicianResult[];
  totalCost: number;
  errors: string[];
};

function lastDayOfMonth(month: string) {
  return monthEnd(month);
}

function monthLabel(month: string) {
  const nomes = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  const [y, m] = month.split("-");
  return `${nomes[Number(m) - 1]}/${y}`;
}

/**
 * Fechamento mensal da quilometragem: calcula as rotas de cada dia do mês e cria
 * UMA única despesa pendente por técnico com o total do mês.
 * Idempotente por técnico + mês (`reference_key = mileage:{tecnico}:{AAAA-MM}`).
 * Despesas diárias antigas pendentes são canceladas e as já pagas são descontadas.
 */
export async function closeMonthlyMileage(
  db: DB,
  input: { month: string; technicianId?: string | null },
): Promise<MonthlyMileageResult> {
  const month = input.month.slice(0, 7);
  const from = monthStart(month);
  const to = lastDayOfMonth(month);
  const out: MonthlyMileageResult = { month, technicians: [], totalCost: 0, errors: [] };

  const { data: jobRun } = await db
    .from("job_runs")
    .insert({ job_name: "fechamento-quilometragem-mensal", reference_date: to } as never)
    .select("id")
    .single();
  const jobId = (jobRun as { id: string } | null)?.id ?? null;

  const { data: visitRows, error: visitError } = await db
    .from("visits")
    .select("technician_id, scheduled_date, status")
    .gte("scheduled_date", from)
    .lte("scheduled_date", to);
  if (visitError) throw visitError;

  const { data: budgetMonthRows } = await db
    .from("budget_visits")
    .select("technician_id, scheduled_date, status")
    .gte("scheduled_date", from)
    .lte("scheduled_date", to);

  const rows = [
    ...((visitRows ?? []) as Array<{
      technician_id: string | null;
      scheduled_date: string;
      status: string;
    }>),
    ...((budgetMonthRows ?? []) as Array<{
      technician_id: string | null;
      scheduled_date: string;
      status: string;
    }>),
  ];

  const byTech = new Map<string | null, Set<string>>();
  for (const r of rows) {
    if (r.status === "Cancelado") continue;
    if (input.technicianId !== undefined && input.technicianId !== null && r.technician_id !== input.technicianId) {
      continue;
    }
    const set = byTech.get(r.technician_id) ?? new Set<string>();
    set.add(r.scheduled_date);
    byTech.set(r.technician_id, set);
  }

  const { data: techRows } = await db.from("technicians").select("id, name");
  const nameById = new Map(
    ((techRows ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  );

  let expensesCreated = 0;
  let expensesUpdated = 0;

  for (const [technicianId, dates] of byTech) {
    const technicianName = technicianId ? (nameById.get(technicianId) ?? "Técnico") : "Sem técnico";
    const item: MonthlyMileageTechnicianResult = {
      technicianId,
      technicianName,
      days: [],
      totalKm: 0,
      totalCost: 0,
      alreadyPaid: 0,
      amountDue: 0,
      expenseId: null,
      canceledDailyExpenses: 0,
      financialDifference: false,
      message: "",
    };

    try {
      for (const date of [...dates].sort()) {
        const res = await syncDailyRoute(db, {
          date,
          technicianId,
          source: "automática",
          createExpense: false,
        });
        if (res.km > 0) {
          item.days.push({ date, km: res.km, cost: res.totalCost, status: res.status });
          item.totalKm = round2(item.totalKm + res.km);
          item.totalCost = round2(item.totalCost + res.totalCost);
        }
      }

      // Consolida despesas diárias antigas: pendentes são canceladas, pagas descontadas.
      const dailyPrefix = `mileage:${technicianId ?? "equipe"}:${month}-`;
      const { data: dailyExpenses } = await db
        .from("expenses")
        .select("id, status, paid_amount, actual_amount, expected_amount, reference_key")
        .like("reference_key", `${dailyPrefix}%`)
        .is("deleted_at", null);
      for (const d of (dailyExpenses ?? []) as Array<{
        id: string;
        status: string;
        paid_amount: number | null;
        actual_amount: number | null;
      }>) {
        const paid = Number(d.paid_amount ?? d.actual_amount ?? 0);
        if (paid > 0 || d.status === "Pago") {
          item.alreadyPaid = round2(item.alreadyPaid + paid);
        } else if (d.status !== "Cancelado") {
          await db
            .from("expenses")
            .update({
              status: "Cancelado",
              notes: `Consolidada no fechamento de quilometragem de ${monthLabel(month)}.`,
            })
            .eq("id", d.id);
          item.canceledDailyExpenses += 1;
        }
      }

      item.amountDue = round2(Math.max(0, item.totalCost - item.alreadyPaid));

      if (item.totalCost <= 0) {
        item.message = "Nenhuma quilometragem calculada neste mês.";
        out.technicians.push(item);
        continue;
      }

      const detalhe = item.days
        .map((d) => `${dateBRShort(d.date)}: ${d.km.toFixed(1).replace(".", ",")} km · R$ ${d.cost.toFixed(2).replace(".", ",")}`)
        .join("\n");
      const observacao = [
        `${item.days.length} dia(s) de rota · ${item.totalKm.toFixed(1).replace(".", ",")} km no mês`,
        item.alreadyPaid > 0
          ? `Descontado R$ ${item.alreadyPaid.toFixed(2).replace(".", ",")} já pago em lançamentos diários.`
          : null,
        detalhe,
      ]
        .filter(Boolean)
        .join("\n");

      const referenceKey = `mileage:${technicianId ?? "equipe"}:${month}`;
      const descricao = `Quilometragem ${technicianName} — ${monthLabel(month)}`;

      const { data: despesa } = await db
        .from("expenses")
        .select("id, status, paid_amount, actual_amount")
        .eq("reference_key", referenceKey)
        .is("deleted_at", null)
        .maybeSingle();

      if (despesa?.id) {
        const paid = Number(despesa.paid_amount ?? despesa.actual_amount ?? 0);
        const jaPago = paid > 0 || despesa.status === "Pago";
        if (jaPago) {
          item.financialDifference = round2(paid) !== item.amountDue;
          await db.from("expenses").update({ notes: observacao }).eq("id", despesa.id);
          item.message = item.financialDifference
            ? "A quilometragem do mês foi recalculada após o pagamento da despesa."
            : "Despesa do mês já paga e sem diferença de valor.";
        } else {
          const { error } = await db
            .from("expenses")
            .update({
              description: descricao,
              category: "Quilometragem",
              beneficiary: technicianName,
              origin: "Rota automática",
              competence_date: to,
              due_date: to,
              expected_amount: item.amountDue,
              actual_amount: null,
              paid_amount: 0,
              payment_date: null,
              status: "Pendente",
              notes: observacao,
            })
            .eq("id", despesa.id);
          if (error) throw error;
          item.message = "Despesa mensal de quilometragem atualizada como pendente.";
        }
        item.expenseId = despesa.id;
        expensesUpdated += 1;
      } else {
        const { data: created, error } = await db
          .from("expenses")
          .insert({
            description: descricao,
            category: "Quilometragem",
            beneficiary: technicianName,
            origin: "Rota automática",
            competence_date: to,
            due_date: to,
            expected_amount: item.amountDue,
            actual_amount: null,
            paid_amount: 0,
            payment_date: null,
            status: "Pendente",
            notes: observacao,
            reference_key: referenceKey,
          } as never)
          .select("id")
          .single();
        if (error) throw error;
        item.expenseId = (created as { id: string }).id;
        item.message = "Despesa mensal de quilometragem lançada como pendente.";
        expensesCreated += 1;
      }

      // Vincula a despesa consolidada às rotas do mês do técnico.
      const linkQuery = db
        .from("daily_routes")
        .update({ expense_id: item.expenseId, financial_difference: item.financialDifference })
        .gte("route_date", from)
        .lte("route_date", to);
      await (technicianId
        ? linkQuery.eq("technician_id", technicianId)
        : linkQuery.is("technician_id", null));

      out.totalCost = round2(out.totalCost + item.amountDue);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      out.errors.push(`${technicianName}: ${message}`);
      item.message = "Não foi possível calcular a rota automaticamente.";
    }

    out.technicians.push(item);
  }

  // Gastos lançados pelo técnico (estacionamento, pedágio, zona azul) do mesmo mês.
  try {
    const { consolidateTechnicianExpenses } = await import("./technician-expenses.server");
    await consolidateTechnicianExpenses(db, {
      month,
      technicianId: input.technicianId ?? null,
    });
  } catch (error) {
    out.errors.push(
      `Gastos do técnico: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (jobId) {
    await db
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: out.errors.length ? "Concluído com erros" : "Concluído",
        technicians_processed: out.technicians.length,
        expenses_created: expensesCreated,
        expenses_updated: expensesUpdated,
        errors: out.errors as never,
        details: { technicians: out.technicians } as never,
      })
      .eq("id", jobId);
  }

  return out;
}
