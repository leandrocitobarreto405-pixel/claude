import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildAddress,
  drivingRoute,
  geocode,
  geocodeParts,
  type Coords,
  type RouteResult,
} from "./geo.server";

type DB = SupabaseClient<Database>;

const SELECT = `
  id, scheduled_time, technician_id,
  work_order:work_orders!visits_work_order_id_fkey(
    os_number,
    customer:customers!work_orders_customer_id_fkey(
      id, full_name, street, street_number, neighborhood, city, state, postal_code, full_address, latitude, longitude
    )
  )
`;

const BUDGET_SELECT = `
  id, scheduled_time, technician_id,
  customer:customers!budget_visits_customer_id_fkey(
    id, full_name, street, street_number, neighborhood, city, state, postal_code, full_address, latitude, longitude
  )
`;

type VisitRow = {
  id: string;
  scheduled_time: string;
  technician_id: string | null;
  work_order: {
    os_number: string;
    customer: VisitCustomer | null;
  } | null;
};

type VisitCustomer = {
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

type BudgetRow = {
  id: string;
  scheduled_time: string;
  technician_id: string | null;
  customer: VisitCustomer | null;
};

export async function calculateDayRoute(
  supabase: DB,
  input: { date: string; technicianId: string | null },
): Promise<RouteResult & { stops: number; baseAddress: string | null }> {
  const failures: string[] = [];

  // 1) Ponto de partida: casa do técnico
  let techQuery = supabase
    .from("technicians")
    .select("id, name, base_address, base_latitude, base_longitude")
    .eq("active", true)
    .order("display_order");
  if (input.technicianId) techQuery = techQuery.eq("id", input.technicianId);
  const { data: techs, error: techError } = await techQuery;
  if (techError) throw techError;
  const tech = techs?.[0];
  if (!tech?.base_address) {
    return {
      legs: [],
      totalKm: 0,
      totalMinutes: 0,
      stops: 0,
      baseAddress: tech?.base_address ?? null,
      failures: ["Cadastre o endereço base do técnico em Configurações > Equipe."],
    };
  }

  let baseCoords: Coords | null =
    tech.base_latitude != null && tech.base_longitude != null
      ? { lat: Number(tech.base_latitude), lon: Number(tech.base_longitude) }
      : null;
  if (!baseCoords) {
    baseCoords = await geocode(tech.base_address);
    if (baseCoords) {
      await supabase
        .from("technicians")
        .update({ base_latitude: baseCoords.lat, base_longitude: baseCoords.lon })
        .eq("id", tech.id);
    }
  }
  if (!baseCoords) {
    return {
      legs: [],
      totalKm: 0,
      totalMinutes: 0,
      stops: 0,
      baseAddress: tech.base_address,
      failures: [`Não localizamos o endereço base do técnico no mapa: ${tech.base_address}`],
    };
  }

  // 2) Paradas do dia, na ordem dos horários
  let visitQuery = supabase
    .from("visits")
    .select(SELECT)
    .eq("scheduled_date", input.date)
    .neq("status", "Cancelado")
    .order("scheduled_time");
  if (input.technicianId) visitQuery = visitQuery.eq("technician_id", input.technicianId);
  const { data, error } = await visitQuery;
  if (error) throw error;
  const visits = (data ?? []) as unknown as VisitRow[];

  // 2b) Visitas de orçamento do dia (sem OS) também são paradas da rota
  let budgetQuery = supabase
    .from("budget_visits")
    .select(BUDGET_SELECT)
    .eq("scheduled_date", input.date)
    .neq("status", "Cancelado")
    .order("scheduled_time");
  if (input.technicianId) budgetQuery = budgetQuery.eq("technician_id", input.technicianId);
  const { data: budgetData, error: budgetError } = await budgetQuery;
  if (budgetError) throw budgetError;
  const budgets = (budgetData ?? []) as unknown as BudgetRow[];

  type Stop = { time: string; customer: VisitCustomer | null; ref: string };
  const stopsToVisit: Stop[] = [
    ...visits.map((v) => ({
      time: v.scheduled_time,
      customer: v.work_order?.customer ?? null,
      ref: `OS ${v.work_order?.os_number ?? "-"}`,
    })),
    ...budgets.map((b) => ({
      time: b.scheduled_time,
      customer: b.customer,
      ref: "Visita de orçamento",
    })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  const points: Array<{ label: string; coords: Coords }> = [
    { label: `Casa do técnico — ${tech.name}`, coords: baseCoords },
  ];

  for (const stop of stopsToVisit) {
    const c = stop.customer;
    if (!c) continue;
    let coords: Coords | null =
      c.latitude != null && c.longitude != null
        ? { lat: Number(c.latitude), lon: Number(c.longitude) }
        : null;
    const address = buildAddress(c);
    if (!coords) {
      coords = await geocodeParts(c);
      if (coords) {
        await supabase
          .from("customers")
          .update({ latitude: coords.lat, longitude: coords.lon })
          .eq("id", c.id);
      }
    }
    if (!coords) {
      failures.push(
        `${c.full_name} — endereço não localizado no mapa (${stop.ref}). ` +
          `Confira rua, número, cidade e CEP no cadastro do cliente.`,
      );
      continue;
    }
    points.push({
      label: `${c.full_name} — ${address || c.full_address || ""} (${stop.ref})`,
      coords,
    });
  }

  if (points.length < 2) {
    return {
      legs: [],
      totalKm: 0,
      totalMinutes: 0,
      stops: 0,
      baseAddress: tech.base_address,
      failures,
    };
  }

  const result = await drivingRoute(points);
  if (!result) {
    failures.push("O serviço de mapas não respondeu. Tente novamente em alguns instantes.");
    return {
      legs: [],
      totalKm: 0,
      totalMinutes: 0,
      stops: points.length - 1,
      baseAddress: tech.base_address,
      failures,
    };
  }

  return { ...result, stops: points.length - 1, baseAddress: tech.base_address, failures };
}
