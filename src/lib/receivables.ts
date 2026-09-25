import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { effectiveVisitValue } from "@/lib/visit-value";

/** Serviços ainda em aberto na agenda (contam como a receber futuro). */
export const RECEIVABLE_SCHEDULED_STATUSES = [
  "Agendado",
  "Confirmado",
  "Em deslocamento",
  "Em execução",
  "Reagendado",
];

export type ReceivableItem = {
  visitId: string;
  workOrderId: string;
  osNumber: string;
  customer: string;
  scheduledDate: string;
  completionDate: string | null;
  technician: string | null;
  serviceLabel: string;
  value: number;
  paid: number;
  discount: number;
  balance: number;
  kind: "agendado" | "concluido";
  status: string;
};

export type Receivables = {
  items: ReceivableItem[];
  scheduled: number;
  completed: number;
  total: number;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type VisitRaw = {
  id: string;
  status: string;
  scheduled_date: string;
  completion_date: string | null;
  visit_value: number | null;
  final_value: number | null;
  discount_amount: number | null;
  discount_reason: string | null;
  work_order_id: string;
  technician: { name: string } | null;
  service_type: { name: string } | null;
  upholstery_type: { name: string } | null;
  upholstery_description: string | null;
  work_order: {
    id: string;
    os_number: string;
    status: string;
    deleted_at: string | null;
    customer: { full_name: string } | null;
  } | null;
};

/**
 * A receber = serviços agendados ainda não pagos + serviços concluídos ainda não pagos.
 * Pagamentos ativos da OS são abatidos primeiro dos serviços concluídos e depois
 * dos agendados, para que o saldo reflita o que realmente falta receber.
 */
export async function fetchReceivables(): Promise<Receivables> {
  const [visitsRes, paymentsRes] = await Promise.all([
    supabase
      .from("visits")
      .select(
        `id, status, scheduled_date, completion_date, visit_value, final_value, work_order_id,
         discount_amount, discount_reason,
         upholstery_description,
         technician:technician_id ( name ),
         service_type:service_type_id ( name ),
         upholstery_type:upholstery_type_id ( name ),
         work_order:work_orders!visits_work_order_id_fkey (
           id, os_number, status, deleted_at, customer:customer_id ( full_name )
         )`,
      )
      .in("status", [...RECEIVABLE_SCHEDULED_STATUSES, "Concluído"])
      .order("scheduled_date"),
    supabase
      .from("payments")
      .select("work_order_id, gross_amount")
      .eq("is_active", true)
      .eq("payment_status", "Pago"),
  ]);
  if (visitsRes.error) throw visitsRes.error;
  if (paymentsRes.error) throw paymentsRes.error;

  const paidByOs = new Map<string, number>();
  for (const p of paymentsRes.data ?? []) {
    const id = p.work_order_id as string;
    paidByOs.set(id, round2((paidByOs.get(id) ?? 0) + Number(p.gross_amount ?? 0)));
  }

  const visits = ((visitsRes.data ?? []) as unknown as VisitRaw[]).filter(
    (v) => v.work_order && !v.work_order.deleted_at && v.work_order.status !== "Cancelada",
  );

  const byOs = new Map<string, VisitRaw[]>();
  for (const v of visits) {
    const list = byOs.get(v.work_order_id) ?? [];
    list.push(v);
    byOs.set(v.work_order_id, list);
  }

  const items: ReceivableItem[] = [];
  for (const [osId, list] of byOs) {
    // Abate o pago primeiro nos concluídos, depois nos agendados.
    const ordered = [...list].sort((a, b) => {
      const ka = a.status === "Concluído" ? 0 : 1;
      const kb = b.status === "Concluído" ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return a.scheduled_date.localeCompare(b.scheduled_date);
    });
    let restante = paidByOs.get(osId) ?? 0;
    for (const v of ordered) {
      const value = round2(effectiveVisitValue(v));
      const discount = round2(Math.max(0, Number(v.discount_amount ?? 0)));
      const paid = round2(Math.min(value, Math.max(0, restante)));
      restante = round2(restante - paid);
      const balance = round2(value - paid - discount);
      if (balance <= 0) continue;
      items.push({
        visitId: v.id,
        workOrderId: osId,
        osNumber: v.work_order?.os_number ?? "",
        customer: v.work_order?.customer?.full_name ?? "—",
        scheduledDate: v.scheduled_date,
        completionDate: v.completion_date,
        technician: v.technician?.name ?? null,
        serviceLabel: [v.service_type?.name, v.upholstery_description || v.upholstery_type?.name]
          .filter(Boolean)
          .join(" — "),
        value,
        paid,
        discount,
        balance,
        kind: v.status === "Concluído" ? "concluido" : "agendado",
        status: v.status,
      });
    }
  }

  items.sort((a, b) =>
    (a.completionDate ?? a.scheduledDate).localeCompare(b.completionDate ?? b.scheduledDate),
  );

  const scheduled = round2(
    items.filter((i) => i.kind === "agendado").reduce((s, i) => s + i.balance, 0),
  );
  const completed = round2(
    items.filter((i) => i.kind === "concluido").reduce((s, i) => s + i.balance, 0),
  );

  return { items, scheduled, completed, total: round2(scheduled + completed) };
}

export function useReceivables() {
  return useQuery({ queryKey: ["a_receber"], queryFn: fetchReceivables });
}
