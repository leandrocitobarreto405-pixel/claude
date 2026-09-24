export const TZ = "America/Sao_Paulo";

export function brl(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

export function decimal(value: number | string | null | undefined, digits = 2): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function pct(value: number | null | undefined, digits = 1): string {
  return `${decimal(value ?? 0, digits)}%`;
}

/** Converte "1.234,56" ou "1234.56" em número. */
export function parseNumberBR(input: string | number | null | undefined): number {
  if (typeof input === "number") return input;
  if (!input) return 0;
  const cleaned = String(input)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** "2026-08-03" -> "03/08/2026" */
export function dateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

/** "14:30:00" -> "14:30" */
export function timeBR(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 5);
}

export function dateTimeBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

/** Data de hoje (fuso de São Paulo) em ISO curto. */
export function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
}

export function tomorrowISO(): string {
  return addDaysISO(todayISO(), 1);
}

const WEEKDAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

export function weekdayPT(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return WEEKDAYS[d.getDay()] ?? "";
}

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "2026-08" ou "2026-08-01" -> "agosto de 2026" */
export function monthLabelPT(month: string): string {
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  return `${MONTHS[idx] ?? ""} de ${y}`;
}

export function monthSlug(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1] ?? ""}_${y}`;
}

/** Mês atual como "YYYY-MM". */
export function currentMonth(): string {
  return todayISO().slice(0, 7);
}

export function monthStart(month: string): string {
  return `${month.slice(0, 7)}-01`;
}

export function monthEnd(month: string): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${month.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Segunda-feira da semana da data informada (ISO yyyy-mm-dd). */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0=domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDaysISO(iso, diff);
}

/** Domingo da semana da data informada. */
export function weekEnd(iso: string): string {
  return addDaysISO(weekStart(iso), 6);
}


export function daysInMonth(month: string): number {
  return Number(monthEnd(month).slice(8));
}

/** Dias restantes no mês (mínimo 1) considerando hoje em São Paulo. */
export function remainingDaysInMonth(month: string): number {
  const today = todayISO();
  if (today.slice(0, 7) !== month.slice(0, 7)) return daysInMonth(month);
  return Math.max(1, daysInMonth(month) - Number(today.slice(8)) + 1);
}

/** Todas as datas de um dia da semana (0=domingo) dentro do mês. */
export function weekdayDatesOfMonth(month: string, weekday: number): string[] {
  const total = daysInMonth(month);
  const out: string[] = [];
  for (let day = 1; day <= total; day++) {
    const iso = `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    if (new Date(`${iso}T12:00:00`).getDay() === weekday) out.push(iso);
  }
  return out;
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function buildFullAddress(parts: {
  street?: string | null;
  street_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}): string {
  const line1 = [parts.street, parts.street_number].filter(Boolean).join(", ");
  const line2 = [parts.complement, parts.neighborhood].filter(Boolean).join(" - ");
  const line3 = [parts.city, parts.state].filter(Boolean).join(" - ");
  const cep = parts.postal_code ? `CEP ${parts.postal_code}` : "";
  return [line1, line2, line3, cep].filter(Boolean).join(", ");
}

export function whatsappLink(phone: string | null | undefined, message?: string): string | null {
  if (!phone) return null;
  const digits = onlyDigits(phone);
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${full}${text}`;
}

export function mapsLink(address: string | null | undefined): string | null {
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
