/**
 * Atalhos de agenda usados pelo app: nunca bloqueiam nem quebram o salvamento.
 * Se a integração estiver desligada ou o Google falhar, apenas registramos o log.
 */
import { cancelVisitEvent, rescheduleVisitEvent, syncVisitEvent } from "@/lib/calendar.functions";

export type AgendaKind = "visit" | "budget";

export async function sincronizarEventoAgenda(kind: AgendaKind, visitId: string | null) {
  if (!visitId) return;
  try {
    await syncVisitEvent({ data: { visitId, kind } });
  } catch (e) {
    console.error("Google Agenda: não foi possível criar o evento.", e);
  }
}

export async function cancelarEventoAgenda(kind: AgendaKind, visitId: string | null) {
  if (!visitId) return;
  try {
    await cancelVisitEvent({ data: { visitId, kind } });
  } catch (e) {
    console.error("Google Agenda: não foi possível cancelar o evento.", e);
  }
}

export async function reagendarEventoAgenda(
  kind: AgendaKind,
  previousVisitId: string,
  newVisitId: string,
) {
  try {
    await rescheduleVisitEvent({ data: { previousVisitId, newVisitId, kind } });
  } catch (e) {
    console.error("Google Agenda: não foi possível reagendar o evento.", e);
  }
}
