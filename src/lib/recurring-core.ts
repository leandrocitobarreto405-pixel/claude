import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { daysInMonth, monthEnd, monthStart, shiftMonth, weekdayDatesOfMonth } from "@/lib/format";

type DB = SupabaseClient<Database>;

export type RecurringTemplate = {
  id: string;
  name: string;
  category: string;
  default_amount: number;
  recurrence: string;
  due_day: number | null;
  weekday: number | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
  beneficiary?: string | null;
};

export type PlannedExpense = {
  templateId: string;
  name: string;
  category: string;
  beneficiary: string | null;
  amount: number;
  competenceDate: string;
  dueDate: string | null;
  referenceKey: string;
  missingDueDay: boolean;
  /** Semanal: um lançamento por data; mensal: um por mês. */
  semanal?: boolean;
};

/** Monta a lista de despesas esperadas do mês a partir dos modelos ativos. */
export function planRecurringMonth(
  templates: RecurringTemplate[],
  month: string,
): PlannedExpense[] {
  const start = monthStart(month);
  const end = monthEnd(month);
  const out: PlannedExpense[] = [];

  for (const t of templates) {
    if (!t.active) continue;
    if (t.end_date && t.end_date < start) continue;
    if (t.start_date && t.start_date > end) continue;

    const beneficiary = t.beneficiary ?? null;

    if (t.recurrence === "weekly" || t.recurrence === "semanal") {
      const weekday = t.weekday ?? 1;
      for (const iso of weekdayDatesOfMonth(month, weekday)) {
        if (t.start_date && iso < t.start_date) continue;
        if (t.end_date && iso > t.end_date) continue;
        out.push({
          templateId: t.id,
          name: t.name,
          category: t.category,
          beneficiary,
          amount: Number(t.default_amount ?? 0),
          competenceDate: iso,
          dueDate: iso,
          referenceKey: `recurring:${t.id}:${iso}`,
          missingDueDay: false,
          semanal: true,
        });
      }
      continue;
    }

    const competence = `${month.slice(0, 7)}-01`;
    if (t.due_day == null) {
      out.push({
        templateId: t.id,
        name: t.name,
        category: t.category,
        beneficiary,
        amount: Number(t.default_amount ?? 0),
        competenceDate: competence,
        dueDate: null,
        referenceKey: `recurring:${t.id}:${month.slice(0, 7)}`,
        missingDueDay: true,
      });
      continue;
    }
    const day = Math.min(t.due_day, daysInMonth(month));
    const dueDate = `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    out.push({
      templateId: t.id,
      name: t.name,
      category: t.category,
      beneficiary,
      amount: Number(t.default_amount ?? 0),
      competenceDate: competence,
      dueDate,
      referenceKey: `recurring:${t.id}:${dueDate}`,
      missingDueDay: false,
    });
  }

  return out;
}

/** Até quando a despesa fixa se repete (03/11): sem fim, até um mês ou por N meses. */
export type FimDaRepeticao =
  { modo: "sem_fim" } | { modo: "ate_mes"; mes: string } | { modo: "meses"; n: number };

/** end_date do modelo: último dia do mês final, ou null sem fim. `inicio` = AAAA-MM do 1º mês. */
export function fimDaRepeticao(inicio: string, f: FimDaRepeticao): string | null {
  if (f.modo === "sem_fim") return null;
  if (f.modo === "ate_mes") {
    const mes = f.mes.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes) || mes < inicio.slice(0, 7))
      throw new Error("O mês final precisa ser igual ou depois do primeiro mês.");
    return monthEnd(mes);
  }
  const n = Math.floor(f.n);
  if (!Number.isFinite(n) || n < 1 || n > 120) throw new Error("Informe de 1 a 120 meses.");
  return monthEnd(shiftMonth(inicio, n - 1));
}

/** Encerrar a despesa fixa (03/11): para de gerar a partir do mês seguinte; nada lançado muda. */
export function fimAoEncerrar(mesAtual: string, endDateAtual: string | null): string {
  const fim = monthEnd(mesAtual);
  return endDateAtual && endDateAtual < fim ? endDateAtual : fim;
}

type LinhaExistente = {
  recurring_expense_id: string | null;
  reference_key: string | null;
  due_date: string | null;
  competence_date: string;
};

/**
 * Já existe lançamento desta despesa fixa no período? Mensal: uma por modelo e mês (mesmo que o dia
 * de vencimento tenha mudado ou que o lançamento do mês tenha sido excluído só naquele mês, 03/11).
 * Semanal: uma por data.
 */
export function jaLancada(p: PlannedExpense, existentes: LinhaExistente[]): boolean {
  const semanal = Boolean(p.semanal);
  return existentes.some((e) => {
    if (e.recurring_expense_id !== p.templateId) return e.reference_key === p.referenceKey;
    if (semanal) return e.due_date === p.dueDate || e.reference_key === p.referenceKey;
    return String(e.competence_date).slice(0, 7) === p.competenceDate.slice(0, 7);
  });
}

export type SyncResult = {
  checked: number;
  created: number;
  existing: number;
  missingDueDay: string[];
  message: string;
};

/**
 * Gera apenas as despesas recorrentes que ainda não existem no mês.
 * Nunca altera lançamentos existentes (inclusive pagos).
 */
export async function syncRecurringMonth(db: DB, month: string): Promise<SyncResult> {
  const { data: templates, error } = await db
    .from("recurring_expenses")
    .select(
      "id, name, category, default_amount, recurrence, due_day, weekday, start_date, end_date, active, beneficiary",
    )
    .eq("active", true);
  if (error) throw error;

  const planned = planRecurringMonth((templates ?? []) as RecurringTemplate[], month);
  if (!planned.length) {
    return {
      checked: 0,
      created: 0,
      existing: 0,
      missingDueDay: [],
      message: "Nenhum modelo recorrente ativo para o mês.",
    };
  }

  // Inclui as excluídas: excluir o lançamento de um mês não faz ele voltar (03/11).
  const { data: existingRows, error: existingError } = await db
    .from("expenses")
    .select("id, reference_key, recurring_expense_id, due_date, competence_date")
    .gte("competence_date", monthStart(month))
    .lte("competence_date", monthEnd(month))
    .not("recurring_expense_id", "is", null);
  if (existingError) throw existingError;

  const toCreate = planned.filter((p) => !jaLancada(p, (existingRows ?? []) as LinhaExistente[]));

  if (toCreate.length) {
    const { error: insertError } = await db.from("expenses").insert(
      toCreate.map((p) => ({
        recurring_expense_id: p.templateId,
        description: p.name,
        category: p.category,
        beneficiary: p.beneficiary,
        origin: "Recorrente",
        competence_date: p.competenceDate,
        due_date: p.dueDate,
        expected_amount: p.amount,
        actual_amount: null,
        paid_amount: 0,
        payment_date: null,
        status: "Pendente",
        reference_key: p.referenceKey,
      })) as never,
    );
    if (insertError) throw insertError;
  }

  const missingDueDay = planned.filter((p) => p.missingDueDay).map((p) => p.name);
  const created = toCreate.length;
  const existing = planned.length - created;

  return {
    checked: planned.length,
    created,
    existing,
    missingDueDay,
    message: `${planned.length} despesa(s) verificada(s). ${created} despesa(s) criada(s) e ${existing} já existente(s).`,
  };
}
