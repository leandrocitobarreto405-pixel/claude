import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildAddress, geocodeParts, type Coords } from "./geo.server";

type DB = SupabaseClient<Database>;

export type DaySuggestion = {
  date: string;
  km: number;
  nearestCustomer: string;
  nearestNeighborhood: string | null;
  stops: number;
  firstTime: string;
  lastTime: string;
  technicianName: string;
};

export type SuggestResult = {
  cep: string;
  address: string | null;
  days: DaySuggestion[];
  failures: string[];
};

type Cust = {
  id: string;
  full_name: string;
  street: string | null;
  street_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  full_address: string | null;
  latitude: number | null;
  longitude: number | null;
};

const CUST = `id, full_name, street, street_number, neighborhood, city, state, postal_code, full_address, latitude, longitude`;

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Distância em linha reta (Haversine) em km. */
function haversine(a: Coords, b: Coords) {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}

/**
 * Sugere os 3 dias já agendados mais próximos de um CEP, nos próximos 30 dias.
 * Usa distância em linha reta (rápida) — o cálculo rodoviário segue no fechamento.
 */
export async function suggestDaysByCep(
  db: DB,
  input: { cep: string; days?: number },
): Promise<SuggestResult> {
  const cep = input.cep.replace(/\D/g, "");
  const failures: string[] = [];
  if (cep.length !== 8) {
    return { cep, address: null, days: [], failures: ["Informe um CEP com 8 dígitos."] };
  }

  // O Nominatim raramente acha um CEP isolado: resolve o endereço no ViaCEP primeiro.
  let parts: Parameters<typeof geocodeParts>[0] = { postal_code: cep };
  let label = `${cep.slice(0, 5)}-${cep.slice(5)}`;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (res.ok) {
      const via = (await res.json()) as {
        erro?: boolean | string;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (!via.erro && via.localidade) {
        parts = {
          street: via.logradouro ?? null,
          neighborhood: via.bairro ?? null,
          city: via.localidade,
          state: via.uf ?? null,
          postal_code: cep,
        };
        label = [via.logradouro, via.bairro, `${via.localidade}/${via.uf ?? ""}`]
          .filter(Boolean)
          .join(", ");
      }
    }
  } catch {
    // sem ViaCEP seguimos apenas com o CEP
  }

  const target = await geocodeParts(parts);
  if (!target) {
    return {
      cep,
      address: null,
      days: [],
      failures: ["Não localizamos esse CEP no mapa. Confira os números e tente novamente."],
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const limit = addDays(today, input.days ?? 30);

  const { data: visitRows, error } = await db
    .from("visits")
    .select(
      `id, scheduled_date, scheduled_time, status,
       technician:technicians!visits_technician_id_fkey(name),
       work_order:work_orders!visits_work_order_id_fkey(deleted_at, status, customer:customers!work_orders_customer_id_fkey(${CUST}))`,
    )
    .gte("scheduled_date", today)
    .lte("scheduled_date", limit)
    .neq("status", "Cancelado")
    .order("scheduled_date")
    .order("scheduled_time");
  if (error) throw error;

  const { data: budgetRows } = await db
    .from("budget_visits")
    .select(
      `id, scheduled_date, scheduled_time, status,
       technician:technicians!budget_visits_technician_id_fkey(name),
       customer:customers!budget_visits_customer_id_fkey(${CUST})`,
    )
    .gte("scheduled_date", today)
    .lte("scheduled_date", limit)
    .neq("status", "Cancelado");

  type Stop = { date: string; time: string; customer: Cust | null; technician: string };
  const stops: Stop[] = [];

  for (const v of (visitRows ?? []) as unknown as Array<{
    scheduled_date: string;
    scheduled_time: string;
    technician: { name: string } | null;
    work_order: { deleted_at: string | null; status: string; customer: Cust | null } | null;
  }>) {
    if (v.work_order?.deleted_at || v.work_order?.status === "Cancelada") continue;
    stops.push({
      date: v.scheduled_date,
      time: v.scheduled_time,
      customer: v.work_order?.customer ?? null,
      technician: v.technician?.name ?? "Sem técnico",
    });
  }
  for (const b of (budgetRows ?? []) as unknown as Array<{
    scheduled_date: string;
    scheduled_time: string;
    technician: { name: string } | null;
    customer: Cust | null;
  }>) {
    stops.push({
      date: b.scheduled_date,
      time: b.scheduled_time,
      customer: b.customer,
      technician: b.technician?.name ?? "Sem técnico",
    });
  }

  const coordsById = new Map<string, Coords>();
  const missing = new Map<string, Cust>();
  for (const s of stops) {
    const c = s.customer;
    if (!c) continue;
    if (c.latitude != null && c.longitude != null) {
      coordsById.set(c.id, { lat: Number(c.latitude), lon: Number(c.longitude) });
    } else if (!missing.has(c.id)) {
      missing.set(c.id, c);
    }
  }

  // Geocodifica no máximo alguns endereços por consulta (limite do serviço gratuito).
  let budgetCalls = 12;
  for (const c of missing.values()) {
    if (budgetCalls-- <= 0) {
      failures.push(
        "Alguns endereços ainda não têm localização salva; repita a busca em instantes.",
      );
      break;
    }
    const coords = await geocodeParts(c);
    if (coords) {
      coordsById.set(c.id, coords);
      await db
        .from("customers")
        .update({ latitude: coords.lat, longitude: coords.lon })
        .eq("id", c.id);
    } else {
      failures.push(`${c.full_name}: endereço não localizado no mapa (${buildAddress(c)}).`);
    }
  }

  type Agg = {
    date: string;
    km: number;
    nearestCustomer: string;
    nearestNeighborhood: string | null;
    stops: number;
    times: string[];
    technicians: Set<string>;
  };
  const byDate = new Map<string, Agg>();
  for (const s of stops) {
    const agg =
      byDate.get(s.date) ??
      ({
        date: s.date,
        km: Number.POSITIVE_INFINITY,
        nearestCustomer: "",
        nearestNeighborhood: null,
        stops: 0,
        times: [],
        technicians: new Set<string>(),
      } satisfies Agg);
    agg.stops += 1;
    agg.times.push(s.time);
    agg.technicians.add(s.technician);
    const coords = s.customer ? coordsById.get(s.customer.id) : undefined;
    if (coords) {
      const km = haversine(target, coords);
      if (km < agg.km) {
        agg.km = km;
        agg.nearestCustomer = s.customer?.full_name ?? "";
        agg.nearestNeighborhood = s.customer?.neighborhood ?? null;
      }
    }
    byDate.set(s.date, agg);
  }

  const days = [...byDate.values()]
    .filter((d) => Number.isFinite(d.km))
    .sort((a, b) => a.km - b.km || a.date.localeCompare(b.date))
    .slice(0, 3)
    .map<DaySuggestion>((d) => {
      const times = d.times.sort();
      return {
        date: d.date,
        km: d.km,
        nearestCustomer: d.nearestCustomer,
        nearestNeighborhood: d.nearestNeighborhood,
        stops: d.stops,
        firstTime: times[0] ?? "",
        lastTime: times[times.length - 1] ?? "",
        technicianName: [...d.technicians].join(", "),
      };
    });

  return { cep, address: label, days, failures };
}
