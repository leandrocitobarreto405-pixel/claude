/**
 * Ações de um toque sobre uma visita em aberto (12/11): "foi feita" conclui com o valor combinado,
 * sem lançar pagamento (o mesmo do "Confirmar conclusão" da Tatiana); "cancelar" tira a visita da
 * agenda. Usadas na tarefa de visita vencida e na lista de visitas antigas em Serviços.
 */
import { supabase } from "@/integrations/supabase/client";
import { cancelarEventoAgenda } from "@/lib/calendar";
import { cancelWorkOrder, completeVisit, logOsHistory, recalcWorkOrder } from "@/lib/os";

type Visita = {
  id: string;
  work_order_id: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  visit_value: number | null;
  final_value: number | null;
  status: string;
};

async function lerVisita(visitId: string): Promise<Visita> {
  const { data, error } = await supabase
    .from("visits")
    .select("id, work_order_id, scheduled_date, scheduled_time, visit_value, final_value, status")
    .eq("id", visitId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Visita não encontrada.");
  return data as unknown as Visita;
}

/** Conclui a visita no dia e hora marcados, com o valor combinado e sem pagamento. */
export async function concluirVisitaSemPagamento(o: {
  visitId: string;
  userId: string | null;
  nota: string;
}): Promise<{ dia: string | null; valor: number }> {
  const v = await lerVisita(o.visitId);
  if (v.status === "Concluído") throw new Error("Essa visita já está concluída.");
  if (v.status === "Cancelado") throw new Error("Essa visita foi cancelada.");
  const valor = Number(v.final_value ?? v.visit_value ?? 0);
  await completeVisit({
    visitId: v.id,
    workOrderId: v.work_order_id,
    finalValue: valor,
    changeReason: null,
    completionDate: v.scheduled_date ?? new Date().toISOString().slice(0, 10),
    completionTime: v.scheduled_time ?? "12:00",
    finalNotes: o.nota,
    payments: [],
    invoiceNeeded: false,
    invoiceIssued: false,
    invoiceNumber: null,
    userId: o.userId,
  });
  return { dia: v.scheduled_date, valor };
}

/**
 * Cancela a visita. Se era a única visita da OS (nenhuma concluída nem outra em aberto), cancela a
 * OS inteira com o motivo; senão cancela só a visita e refaz a conta da OS.
 */
export async function cancelarVisitaEmAberto(o: {
  visitId: string;
  userId: string | null;
  motivo: string;
}): Promise<"os" | "visita"> {
  const v = await lerVisita(o.visitId);
  if (v.status === "Concluído") throw new Error("Essa visita já está concluída.");
  if (v.status === "Cancelado") return "visita";
  const { data: outras, error } = await supabase
    .from("visits")
    .select("id, status")
    .eq("work_order_id", v.work_order_id)
    .neq("id", v.id)
    .neq("status", "Cancelado");
  if (error) throw error;
  if (!(outras ?? []).length) {
    await cancelWorkOrder({ workOrderId: v.work_order_id, reason: o.motivo, userId: o.userId });
    return "os";
  }
  const { error: e2 } = await supabase
    .from("visits")
    .update({ status: "Cancelado" })
    .eq("id", v.id);
  if (e2) throw e2;
  await cancelarEventoAgenda("visit", v.id);
  await logOsHistory({
    workOrderId: v.work_order_id,
    eventType: "Cancelamento",
    description: `Visita cancelada. Motivo: ${o.motivo}`,
    userId: o.userId,
  });
  await recalcWorkOrder(v.work_order_id, o.userId);
  return "visita";
}
