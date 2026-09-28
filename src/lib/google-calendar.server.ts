/**
 * Integração servidor-only com o Google Agenda, com a conta Google da empresa ativa.
 * Segue o mesmo padrão de erros de google-docs.server.ts.
 */
import { esquecerTokenGoogle, tokenGoogle } from "@/lib/google-auth.server";
import { contextoEmpresa } from "@/lib/request-db.server";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${CALENDAR_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${await tokenGoogle()}`, "Content-Type": "application/json" },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Google Agenda ${path} falhou [${res.status}]: ${text}`);
    if (res.status === 401) esquecerTokenGoogle(contextoEmpresa().empresaId);
    if (res.status === 404) throw new Error("Agenda ou evento não encontrado no Google.");
    if (res.status === 401 || res.status === 403)
      throw new Error("Sem acesso à agenda no Google. Verifique a conta conectada.");
    throw new Error(`Falha na comunicação com o Google Agenda (${res.status}).`);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

export const TIMEZONE = "America/Sao_Paulo";

export type CalendarEventInput = {
  calendarId: string;
  summary: string;
  description: string;
  location?: string | null;
  /** Data no formato YYYY-MM-DD. */
  date: string;
  /** Hora no formato HH:MM (ou HH:MM:SS). */
  time: string;
  /** Duração em minutos. */
  durationMinutes?: number;
  attendeeEmail?: string | null;
};

export type CalendarEvent = { id: string; htmlLink?: string; summary?: string };

function localDateTime(date: string, time: string, addMinutes = 0) {
  const hhmm = (time || "09:00").slice(0, 5);
  const [h, m] = hhmm.split(":").map((n) => Number(n) || 0);
  const total = (h ?? 0) * 60 + (m ?? 0) + addMinutes;
  const hh = String(Math.floor((total % (24 * 60)) / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${date}T${hh}:${mm}:00`;
}

function eventBody(input: CalendarEventInput) {
  const dur = input.durationMinutes ?? 120;
  return {
    summary: input.summary,
    description: input.description,
    ...(input.location ? { location: input.location } : {}),
    start: { dateTime: localDateTime(input.date, input.time), timeZone: TIMEZONE },
    end: { dateTime: localDateTime(input.date, input.time, dur), timeZone: TIMEZONE },
    ...(input.attendeeEmail ? { attendees: [{ email: input.attendeeEmail }] } : {}),
    reminders: { useDefault: true },
  };
}

function cal(calendarId: string) {
  return encodeURIComponent(calendarId || "primary");
}

export async function createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  return call<CalendarEvent>(
    `/calendars/${cal(input.calendarId)}/events?sendUpdates=all&conferenceDataVersion=0`,
    { method: "POST", body: eventBody(input) },
  );
}

export async function updateEvent(
  eventId: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  return call<CalendarEvent>(
    `/calendars/${cal(input.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "PATCH", body: eventBody(input) },
  );
}

/** Mantém o evento na agenda, marcado como cancelado, e retira o convite do técnico. */
export async function cancelEvent(calendarId: string, eventId: string) {
  const atual = await call<CalendarEvent>(
    `/calendars/${cal(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  const titulo = atual.summary ?? "";
  const summary = titulo.startsWith("CANCELADO") ? titulo : `CANCELADO — ${titulo}`;
  await call(
    `/calendars/${cal(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "PATCH",
      body: { summary, attendees: [] },
    },
  );
}

export async function deleteEvent(calendarId: string, eventId: string) {
  await call(
    `/calendars/${cal(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "DELETE",
    },
  );
}

/** Confere se a agenda configurada está acessível. */
export async function testCalendarConnection(calendarId: string) {
  // Lista de eventos (permitida pela permissão de eventos) traz o nome da agenda.
  const data = await call<{ summary?: string }>(
    `/calendars/${cal(calendarId)}/events?maxResults=1&fields=summary`,
  );
  return { id: calendarId || "primary", name: data.summary ?? calendarId ?? "primary" };
}
