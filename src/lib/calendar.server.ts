/**
 * Monta e sincroniza os eventos do Google Agenda a partir dos atendimentos
 * (visits) e das visitas de orçamento (budget_visits).
 * Nunca lança erro para quem chamou: falha do Google não bloqueia o agendamento.
 */

import {
  cancelEvent,
  createEvent,
  testCalendarConnection,
  updateEvent,
} from "@/lib/google-calendar.server";
import { bancoDaEmpresa } from "@/lib/request-db.server";

const SETTINGS_KEY = "google_calendar_settings";

export type CalendarSettings = {
  enabled: boolean;
  calendarId: string;
  durationMinutes: number;
};

export type VisitKind = "visit" | "budget";

/** Banco da requisição: cliente do usuário, restrito pelo RLS à empresa ativa. */
async function admin() {
  return bancoDaEmpresa();
}

export async function readSettings(): Promise<CalendarSettings> {
  const db = await admin();
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  const v = (data?.value ?? {}) as Partial<CalendarSettings>;
  return {
    enabled: v.enabled ?? false,
    calendarId: v.calendarId || "primary",
    durationMinutes: Number(v.durationMinutes ?? 120) || 120,
  };
}

export async function saveSettings(input: {
  enabled: boolean;
  calendarId: string;
  durationMinutes: number;
}): Promise<CalendarSettings> {
  const db = await admin();
  const value: CalendarSettings = {
    enabled: Boolean(input.enabled),
    calendarId: (input.calendarId || "primary").trim() || "primary",
    durationMinutes: Number(input.durationMinutes) > 0 ? Number(input.durationMinutes) : 120,
  };
  const { error } = await db
    .from("app_settings")
    .upsert({ key: SETTINGS_KEY, value } as never, { onConflict: "empresa_id,key" });
  if (error) throw error;
  return value;
}

export async function testIntegration() {
  const s = await readSettings();
  const info = await testCalendarConnection(s.calendarId);
  return { ok: true as const, calendar: info.name };
}

type EventoDados = {
  summary: string;
  description: string;
  location: string | null;
  date: string;
  time: string;
  attendeeEmail: string | null;
  eventId: string | null;
};

function endereco(c: Record<string, unknown> | null): string {
  if (!c) return "";
  const full = (c["full_address"] as string | null) ?? "";
  if (full) return full;
  const partes = [
    [c["street"], c["street_number"]].filter(Boolean).join(", "),
    c["complement"],
    c["neighborhood"],
    [c["city"], c["state"]].filter(Boolean).join(" - "),
    c["postal_code"],
  ];
  return partes.filter(Boolean).join(" · ");
}

function descricao(parts: Array<[string, string | null | undefined]>) {
  return parts
    .filter(([, v]) => v && String(v).trim())
    .map(([label, v]) => `${label}: ${String(v).trim()}`)
    .join("\n");
}

async function dadosDoAtendimento(visitId: string): Promise<EventoDados | null> {
  const db = await admin();
  const { data, error } = await db
    .from("visits")
    .select(
      `id, scheduled_date, scheduled_time, upholstery_description, visit_notes, google_event_id,
       technician:technician_id ( name, email ),
       service_type:service_type_id ( name ),
       work_order:work_order_id (
         os_number,
         customer:customer_id ( full_name, phone, full_address, street, street_number, complement,
           neighborhood, city, state, postal_code )
       )`,
    )
    .eq("id", visitId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Record<string, any>;
  const wo = row["work_order"] as Record<string, any> | null;
  const cliente = (wo?.["customer"] ?? null) as Record<string, unknown> | null;
  const nome = (cliente?.["full_name"] as string | null) ?? "Cliente";
  const local = endereco(cliente);
  return {
    summary: `OS ${wo?.["os_number"] ?? ""} - ${nome}`.trim(),
    description: descricao([
      ["Endereço", local],
      ["Serviço", (row["service_type"]?.["name"] as string | null) ?? null],
      ["Estofados", row["upholstery_description"] as string | null],
      ["Telefone", (cliente?.["phone"] as string | null) ?? null],
      ["Observações", row["visit_notes"] as string | null],
    ]),
    location: local || null,
    date: row["scheduled_date"] as string,
    time: row["scheduled_time"] as string,
    attendeeEmail: (row["technician"]?.["email"] as string | null) ?? null,
    eventId: (row["google_event_id"] as string | null) ?? null,
  };
}

async function dadosDaVisitaOrcamento(visitId: string): Promise<EventoDados | null> {
  const db = await admin();
  const { data, error } = await db
    .from("budget_visits")
    .select(
      `id, scheduled_date, scheduled_time, upholstery_description, notes, google_event_id,
       technician:technician_id ( name, email ),
       customer:customer_id ( full_name, phone, full_address, street, street_number, complement,
         neighborhood, city, state, postal_code )`,
    )
    .eq("id", visitId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Record<string, any>;
  const cliente = (row["customer"] ?? null) as Record<string, unknown> | null;
  const nome = (cliente?.["full_name"] as string | null) ?? "Cliente";
  const local = endereco(cliente);
  return {
    summary: `Orçamento - ${nome}`,
    description: descricao([
      ["Endereço", local],
      ["Serviço", "Visita de orçamento"],
      ["Estofados", row["upholstery_description"] as string | null],
      ["Telefone", (cliente?.["phone"] as string | null) ?? null],
      ["Observações", row["notes"] as string | null],
    ]),
    location: local || null,
    date: row["scheduled_date"] as string,
    time: row["scheduled_time"] as string,
    attendeeEmail: (row["technician"]?.["email"] as string | null) ?? null,
    eventId: (row["google_event_id"] as string | null) ?? null,
  };
}

function tabela(kind: VisitKind) {
  return kind === "budget" ? "budget_visits" : "visits";
}

async function dados(kind: VisitKind, visitId: string) {
  return kind === "budget" ? dadosDaVisitaOrcamento(visitId) : dadosDoAtendimento(visitId);
}

async function gravarEventoId(kind: VisitKind, visitId: string, eventId: string | null) {
  const db = await admin();
  await db
    .from(tabela(kind))
    .update({ google_event_id: eventId } as never)
    .eq("id", visitId);
}

export type SyncResult = { ok: boolean; skipped?: boolean; message?: string };

/** Cria (ou atualiza) o evento do atendimento no Google Agenda. */
export async function syncEvent(kind: VisitKind, visitId: string): Promise<SyncResult> {
  try {
    const s = await readSettings();
    if (!s.enabled) return { ok: true, skipped: true };
    const d = await dados(kind, visitId);
    if (!d || !d.date) return { ok: true, skipped: true };

    const payload = {
      calendarId: s.calendarId,
      summary: d.summary,
      description: d.description,
      location: d.location,
      date: d.date,
      time: d.time,
      durationMinutes: s.durationMinutes,
      attendeeEmail: d.attendeeEmail,
    };

    if (d.eventId) {
      try {
        await updateEvent(d.eventId, payload);
        return { ok: true };
      } catch (e) {
        console.error("Falha ao atualizar evento; criando um novo.", e);
      }
    }
    const evento = await createEvent(payload);
    await gravarEventoId(kind, visitId, evento.id);
    return { ok: true };
  } catch (e) {
    console.error("Google Agenda: falha ao sincronizar evento.", e);
    return { ok: false, message: e instanceof Error ? e.message : "Falha no Google Agenda." };
  }
}

/** Marca o evento como cancelado, mantendo o histórico na agenda. */
export async function cancelEventForVisit(kind: VisitKind, visitId: string): Promise<SyncResult> {
  try {
    const s = await readSettings();
    if (!s.enabled) return { ok: true, skipped: true };
    const d = await dados(kind, visitId);
    if (!d?.eventId) return { ok: true, skipped: true };
    await cancelEvent(s.calendarId, d.eventId);
    return { ok: true };
  } catch (e) {
    console.error("Google Agenda: falha ao cancelar evento.", e);
    return { ok: false, message: e instanceof Error ? e.message : "Falha no Google Agenda." };
  }
}

/**
 * Reagendamento: cancela o evento anterior e cria um evento novo na nova data.
 * `novoId` pode ser a própria visita (reagendamento sem deslocamento).
 */
export async function rescheduleEvent(
  kind: VisitKind,
  anteriorId: string,
  novoId: string,
): Promise<SyncResult> {
  const s = await readSettings();
  if (!s.enabled) return { ok: true, skipped: true };

  if (anteriorId === novoId) {
    // Mesma visita: encerra o evento antigo e desvincula antes de criar o novo.
    const d = await dados(kind, anteriorId);
    if (d?.eventId) {
      await cancelEventForVisit(kind, anteriorId);
      await gravarEventoId(kind, anteriorId, null);
    }
    return syncEvent(kind, novoId);
  }

  await cancelEventForVisit(kind, anteriorId);
  return syncEvent(kind, novoId);
}
