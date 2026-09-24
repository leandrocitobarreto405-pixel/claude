import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { monthEnd, monthStart, monthLabelPT } from "./format";

type DB = SupabaseClient<Database>;

export type TechnicianExpenseClosing = {
  month: string;
  technicianId: string | null;
  technicianName: string;
  entries: number;
  total: number;
  expenseId: string | null;
  message: string;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function dateBRShort(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Consolida os gastos lançados pelo técnico (estacionamento, pedágio, zona azul)
 * em UMA única despesa pendente por técnico e mês, vencendo no último dia do mês.
 * Idempotente: `reference_key = tech-expenses:{tecnico}:{AAAA-MM}`.
 */
export async function consolidateTechnicianExpenses(
  db: DB,
  input: { month: string; technicianId?: string | null },
): Promise<TechnicianExpenseClosing[]> {
  const month = input.month.slice(0, 7);
  const from = monthStart(month);
  const to = monthEnd(month);

  let q = db
    .from("technician_expenses")
    .select("id, technician_id, expense_date, categories, amount, notes")
    .gte("expense_date", from)
    .lte("expense_date", to)
    .order("expense_date");
  if (input.technicianId) q = q.eq("technician_id", input.technicianId);
  const { data, error } = await q;
  if (error) throw error;

  type Row = {
    id: string;
    technician_id: string | null;
    expense_date: string;
    categories: string[] | null;
    amount: number | null;
  };
  const rows = (data ?? []) as Row[];

  const { data: techRows } = await db.from("technicians").select("id, name");
  const nameById = new Map(
    ((techRows ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  );

  const byTech = new Map<string | null, Row[]>();
  for (const r of rows) {
    const list = byTech.get(r.technician_id) ?? [];
    list.push(r);
    byTech.set(r.technician_id, list);
  }
  // Garante o processamento de um técnico filtrado mesmo sem lançamentos (zera a despesa).
  if (input.technicianId && !byTech.has(input.technicianId)) byTech.set(input.technicianId, []);

  const out: TechnicianExpenseClosing[] = [];

  for (const [technicianId, list] of byTech) {
    const technicianName = technicianId ? (nameById.get(technicianId) ?? "Técnico") : "Sem técnico";
    const total = round2(list.reduce((s, r) => s + Number(r.amount ?? 0), 0));
    const referenceKey = `tech-expenses:${technicianId ?? "equipe"}:${month}`;
    const descricao = `Gastos de deslocamento — ${technicianName} — ${monthLabelPT(month)}`;
    const detalhe = list
      .map(
        (r) =>
          `${dateBRShort(r.expense_date)}: ${(r.categories ?? []).join(" + ") || "Gasto"} · R$ ${Number(
            r.amount ?? 0,
          )
            .toFixed(2)
            .replace(".", ",")}`,
      )
      .join("\n");
    const observacao = [`${list.length} lançamento(s) no mês`, detalhe].filter(Boolean).join("\n");

    const { data: despesa } = await db
      .from("expenses")
      .select("id, status, paid_amount, actual_amount")
      .eq("reference_key", referenceKey)
      .is("deleted_at", null)
      .maybeSingle();

    const item: TechnicianExpenseClosing = {
      month,
      technicianId,
      technicianName,
      entries: list.length,
      total,
      expenseId: despesa?.id ?? null,
      message: "",
    };

    if (despesa?.id) {
      const paid = Number(despesa.paid_amount ?? despesa.actual_amount ?? 0);
      if (paid > 0 || despesa.status === "Pago") {
        await db.from("expenses").update({ notes: observacao }).eq("id", despesa.id);
        item.message =
          round2(paid) === total
            ? "Despesa do mês já paga e sem diferença de valor."
            : "Os gastos mudaram depois do pagamento da despesa do mês.";
      } else if (total <= 0) {
        await db
          .from("expenses")
          .update({ status: "Cancelado", expected_amount: 0, notes: "Sem gastos lançados no mês." })
          .eq("id", despesa.id);
        item.message = "Nenhum gasto no mês: despesa cancelada.";
      } else {
        const { error: upErr } = await db
          .from("expenses")
          .update({
            description: descricao,
            category: "Deslocamento",
            beneficiary: technicianName,
            origin: "Lançamento do técnico",
            competence_date: to,
            due_date: to,
            expected_amount: total,
            actual_amount: null,
            paid_amount: 0,
            payment_date: null,
            status: "Pendente",
            notes: observacao,
          })
          .eq("id", despesa.id);
        if (upErr) throw upErr;
        item.message = "Despesa mensal de gastos atualizada como pendente.";
      }
    } else if (total > 0) {
      const { data: created, error: insErr } = await db
        .from("expenses")
        .insert({
          description: descricao,
          category: "Deslocamento",
          beneficiary: technicianName,
          origin: "Lançamento do técnico",
          competence_date: to,
          due_date: to,
          expected_amount: total,
          actual_amount: null,
          paid_amount: 0,
          payment_date: null,
          status: "Pendente",
          notes: observacao,
          reference_key: referenceKey,
        } as never)
        .select("id")
        .single();
      if (insErr) throw insErr;
      item.expenseId = (created as { id: string }).id;
      item.message = "Despesa mensal de gastos lançada como pendente.";
    } else {
      item.message = "Nenhum gasto lançado no mês.";
    }

    if (item.expenseId && list.length) {
      await db
        .from("technician_expenses")
        .update({ expense_id: item.expenseId })
        .in(
          "id",
          list.map((r) => r.id),
        );
    }

    out.push(item);
  }

  return out;
}
