import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Banco } from "@/lib/banco";
import { STATUS_RECEBIDOS } from "@/lib/payments";
import { todayISO } from "@/lib/format";
import { visitasComValor } from "@/lib/vendido";

/** Situações de visita ainda por fazer (agenda). */
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

export type VisitRaw = {
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
    total_gross_value: number | null;
    deleted_at: string | null;
    eh_teste?: boolean;
    customer: { full_name: string } | null;
  } | null;
};

/**
 * Saldo em aberto de UMA OS, por visita: total da OS − pagamentos recebidos − saldos dispensados.
 * O valor de cada visita já vem com o desconto da OS repartido (vendido.ts), então a soma das
 * visitas é o total da OS. O pago é abatido primeiro das concluídas, depois das agendadas.
 */
export function saldosDaOs(
  os: { total_gross_value: number | null },
  visitas: VisitRaw[],
  pago: number,
  hoje: string,
): Array<{ visita: VisitRaw; value: number; paid: number; discount: number; balance: number }> {
  const comValor = visitasComValor(
    {
      id: "",
      os_number: "",
      total_gross_value: os.total_gross_value,
      status: "",
      eh_teste: false,
      deleted_at: null,
      visitas: visitas.map((v) => ({ ...v, repasse_parceiro: 0 })),
    },
    hoje,
  );
  const porId = new Map(visitas.map((v) => [v.id, v]));
  const ordem = [...comValor].sort((a, b) => {
    const ka = a.situacao === "realizado" ? 0 : 1;
    const kb = b.situacao === "realizado" ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return (porId.get(a.visitaId)?.scheduled_date ?? "").localeCompare(
      porId.get(b.visitaId)?.scheduled_date ?? "",
    );
  });
  let restante = round2(Math.max(0, pago));
  return ordem.map((c) => {
    const value = round2(c.valor);
    const discount = round2(c.dispensado);
    const devido = round2(Math.max(0, value - discount));
    const paid = round2(Math.min(devido, restante));
    restante = round2(restante - paid);
    return {
      visita: porId.get(c.visitaId)!,
      value,
      paid,
      discount,
      balance: round2(devido - paid),
    };
  });
}

/**
 * A receber = para cada OS, total da OS − pagamentos recebidos (− saldos dispensados), aberto por
 * visita em "concluído" e "agendado". A soma bate com total das OS − pagos. OS de teste, cancelada
 * ou excluída fica fora; visita cancelada também.
 */
export async function fetchReceivables(db: Banco = supabase): Promise<Receivables> {
  const [visitsRes, paymentsRes] = await Promise.all([
    db
      .from("visits")
      .select(
        `id, status, scheduled_date, completion_date, visit_value, final_value, work_order_id,
         discount_amount, discount_reason,
         upholstery_description,
         technician:technician_id ( name ),
         service_type:service_type_id ( name ),
         upholstery_type:upholstery_type_id ( name ),
         work_order:work_orders!visits_work_order_id_fkey (
           id, os_number, status, total_gross_value, deleted_at, eh_teste,
           customer:customer_id ( full_name )
         )`,
      )
      .neq("status", "Cancelado")
      .order("scheduled_date"),
    db
      .from("payments")
      .select("work_order_id, gross_amount")
      .eq("is_active", true)
      .in("payment_status", STATUS_RECEBIDOS),
  ]);
  if (visitsRes.error) throw visitsRes.error;
  if (paymentsRes.error) throw paymentsRes.error;

  const paidByOs = new Map<string, number>();
  for (const p of paymentsRes.data ?? []) {
    const id = p.work_order_id as string;
    paidByOs.set(id, round2((paidByOs.get(id) ?? 0) + Number(p.gross_amount ?? 0)));
  }

  // OS de teste ficam fora, como em todo número do app.
  const visits = ((visitsRes.data ?? []) as unknown as VisitRaw[]).filter(
    (v) =>
      v.work_order &&
      !v.work_order.deleted_at &&
      !v.work_order.eh_teste &&
      v.work_order.status !== "Cancelada",
  );

  const byOs = new Map<string, VisitRaw[]>();
  for (const v of visits) {
    const list = byOs.get(v.work_order_id) ?? [];
    list.push(v);
    byOs.set(v.work_order_id, list);
  }

  const hoje = todayISO();
  const items: ReceivableItem[] = [];
  for (const [osId, list] of byOs) {
    const wo = list[0]!.work_order!;
    for (const s of saldosDaOs(wo, list, paidByOs.get(osId) ?? 0, hoje)) {
      if (s.balance <= 0) continue;
      const v = s.visita;
      items.push({
        visitId: v.id,
        workOrderId: osId,
        osNumber: wo.os_number ?? "",
        customer: wo.customer?.full_name ?? "—",
        scheduledDate: v.scheduled_date,
        completionDate: v.completion_date,
        technician: v.technician?.name ?? null,
        serviceLabel: [v.service_type?.name, v.upholstery_description || v.upholstery_type?.name]
          .filter(Boolean)
          .join(" — "),
        value: s.value,
        paid: s.paid,
        discount: s.discount,
        balance: s.balance,
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
  return useQuery({ queryKey: ["a_receber"], queryFn: () => fetchReceivables() });
}
