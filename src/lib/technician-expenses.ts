import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { monthEnd, monthStart } from "@/lib/format";

export const TECHNICIAN_EXPENSE_CATEGORIES = ["Estacionamento", "Pedágio", "Zona azul"] as const;
export type TechnicianExpenseCategory = (typeof TECHNICIAN_EXPENSE_CATEGORIES)[number];

export type TechnicianExpenseRow = {
  id: string;
  technician_id: string | null;
  expense_date: string;
  categories: string[] | null;
  amount: number;
  notes: string | null;
  expense_id: string | null;
  work_order_id: string | null;
  work_order: { id: string; os_number: string; customer: { full_name: string } | null } | null;
  technician: { id: string; name: string } | null;
};

const SELECT = `
  id, technician_id, expense_date, categories, amount, notes, expense_id, work_order_id,
  work_order:work_orders!technician_expenses_work_order_id_fkey(id, os_number, customer:customers!work_orders_customer_id_fkey(full_name)),
  technician:technicians!technician_expenses_technician_id_fkey(id, name)
`;

/** Lançamentos de gastos do mês (opcionalmente de um técnico). */
export function useTechnicianExpenses(month: string, technicianId?: string | null) {
  return useQuery({
    queryKey: ["technician_expenses", month, technicianId ?? "todos"],
    queryFn: async () => {
      let q = supabase
        .from("technician_expenses")
        .select(SELECT)
        .gte("expense_date", monthStart(month))
        .lte("expense_date", monthEnd(month))
        .order("expense_date", { ascending: false });
      if (technicianId) q = q.eq("technician_id", technicianId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as TechnicianExpenseRow[];
    },
  });
}

/** OSs com atendimento na data escolhida, para o técnico selecionar. */
export function useWorkOrdersOfDay(date: string, technicianId?: string | null) {
  return useQuery({
    queryKey: ["oss-do-dia", date, technicianId ?? "todos"],
    queryFn: async () => {
      let q = supabase
        .from("visits")
        .select(
          `work_order:work_orders!visits_work_order_id_fkey(id, os_number, deleted_at, customer:customers!work_orders_customer_id_fkey(full_name))`,
        )
        .eq("scheduled_date", date)
        .neq("status", "Cancelado");
      if (technicianId) q = q.eq("technician_id", technicianId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{
        work_order: {
          id: string;
          os_number: string;
          deleted_at: string | null;
          customer: { full_name: string } | null;
        } | null;
      }>;
      const map = new Map<string, { id: string; label: string }>();
      for (const r of rows) {
        const wo = r.work_order;
        if (!wo || wo.deleted_at) continue;
        map.set(wo.id, {
          id: wo.id,
          label: `OS ${wo.os_number} — ${wo.customer?.full_name ?? "cliente"}`,
        });
      }
      return [...map.values()];
    },
  });
}

export type TechnicianExpenseInput = {
  technicianId: string;
  date: string;
  categories: string[];
  amount: number;
  workOrderId: string | null;
  notes: string | null;
};

export async function saveTechnicianExpense(input: TechnicianExpenseInput, id?: string | null) {
  const payload = {
    technician_id: input.technicianId,
    expense_date: input.date,
    categories: input.categories,
    amount: input.amount,
    work_order_id: input.workOrderId,
    notes: input.notes,
  };
  if (id) {
    const { error } = await supabase.from("technician_expenses").update(payload).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase
    .from("technician_expenses")
    .insert(payload as never)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deleteTechnicianExpense(id: string) {
  const { error } = await supabase.from("technician_expenses").delete().eq("id", id);
  if (error) throw error;
}
