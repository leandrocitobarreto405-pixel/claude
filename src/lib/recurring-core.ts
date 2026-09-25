import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { daysInMonth, monthEnd, monthStart, weekdayDatesOfMonth } from "@/lib/format";

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

  const { data: existingRows, error: existingError } = await db
    .from("expenses")
    .select("id, reference_key, recurring_expense_id, due_date, competence_date")
    .is("deleted_at", null)
    .gte("competence_date", monthStart(month))
    .lte("competence_date", monthEnd(month))
    .not("recurring_expense_id", "is", null);
  if (existingError) throw existingError;

  const existingKeys = new Set<string>();
  for (const row of existingRows ?? []) {
    if (row.reference_key) existingKeys.add(row.reference_key);
    if (row.recurring_expense_id) {
      existingKeys.add(
        row.due_date
          ? `recurring:${row.recurring_expense_id}:${row.due_date}`
          : `recurring:${row.recurring_expense_id}:${String(row.competence_date).slice(0, 7)}`,
      );
    }
  }

  const toCreate = planned.filter((p) => !existingKeys.has(p.referenceKey));

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
