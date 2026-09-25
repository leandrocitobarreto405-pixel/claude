/** Geocodificação (Nominatim/OpenStreetMap) e distância rodoviária (OSRM). Server-only. */

export type Coords = { lat: number; lon: number };

export type RouteLeg = {
  from: string;
  to: string;
  km: number;
  minutes: number;
};

export type RouteResult = {
  legs: RouteLeg[];
  totalKm: number;
  totalMinutes: number;
  failures: string[];
};

const UA = "NexaOS/1.0 (roteirizacao interna)";

export type AddressParts = {
  street?: string | null;
  street_number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  full_address?: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Respeita o limite de 1 consulta por segundo do Nominatim. */
let lastCall = 0;
async function throttle() {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

function digits(v: string | null | undefined) {
  return clean(v).replace(/\D/g, "");
}

function normalizeName(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();
}

type NominatimHit = {
  lat: string;
  lon: string;
  address?: Record<string, string>;
};

type Expected = { city?: string; state?: string; postcodePrefix?: string };

/** Descarta resultados de outra cidade/estado (evita cair em municípios homônimos). */
function matchesExpected(hit: NominatimHit, expected: Expected) {
  const addr = hit.address;
  if (!addr) return true;
  if (expected.state) {
    const st = normalizeName(addr["state"] ?? "");
    const wanted = normalizeName(expected.state);
    const UF: Record<string, string> = {
      sp: "sao paulo",
      rj: "rio de janeiro",
      mg: "minas gerais",
      pr: "parana",
    };
    const wantedFull = UF[wanted] ?? wanted;
    if (st && wantedFull && st !== wantedFull) return false;
  }
  if (expected.city) {
    const candidates = [
      addr["city"],
      addr["town"],
      addr["municipality"],
      addr["village"],
      addr["county"],
    ]
      .filter(Boolean)
      .map((v) => normalizeName(String(v)));
    const wanted = normalizeName(expected.city);
    if (candidates.length && wanted && !candidates.some((c) => c === wanted)) return false;
  }
  if (expected.postcodePrefix) {
    // Consulta por CEP: só aceita se o resultado devolver um CEP da mesma região,
    // senão o Nominatim cai no centro da cidade e distorce a quilometragem.
    const got = (addr["postcode"] ?? "").replace(/\D/g, "");
    if (got.slice(0, 5) !== expected.postcodePrefix) return false;
  }
  return true;
}

async function nominatim(
  params: Record<string, string>,
  expected?: Expected,
): Promise<Coords | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "br");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR" } });
      if (res.status === 429 || res.status === 503) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as NominatimHit[];
      for (const hit of json) {
        const lat = Number(hit.lat);
        const lon = Number(hit.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (expected && !matchesExpected(hit, expected)) continue;
        return { lat, lon };
      }
      return null;
    } catch {
      await sleep(800);
    }
  }
  return null;
}

/**
 * Localiza o endereço no mapa tentando do mais específico ao mais amplo:
 * rua+número, rua, CEP (validado) e, por último, bairro/cidade. Bairro e CEP
 * juntos costumam impedir o match no Nominatim, por isso as variações sem
 * esses campos vêm antes. Resultados de outra cidade/estado são descartados.
 */
export async function geocodeParts(parts: AddressParts): Promise<Coords | null> {
  const street = clean(parts.street);
  const number = clean(parts.street_number).replace(/\D/g, "");
  const city = clean(parts.city);
  const state = clean(parts.state);
  const neighborhood = clean(parts.neighborhood);
  const cep = digits(parts.postal_code);
  const base: Expected = { ...(city ? { city } : {}), ...(state ? { state } : {}) };
  const attempts: Array<{ params: Record<string, string>; expected: Expected }> = [];

  if (street && city) {
    const streetQ = number ? `${number} ${street}` : street;
    attempts.push({
      params: { street: streetQ, city, ...(state ? { state } : {}), country: "Brazil" },
      expected: base,
    });
    attempts.push({
      params: {
        q: [`${street}${number ? `, ${number}` : ""}`, city, state].filter(Boolean).join(", "),
      },
      expected: base,
    });
    attempts.push({
      params: { q: [street, city, state].filter(Boolean).join(", ") },
      expected: base,
    });
  }
  if (cep.length === 8) {
    const expected: Expected = { ...base, postcodePrefix: cep.slice(0, 5) };
    attempts.push({
      params: { postalcode: cep, ...(city ? { city } : {}), country: "Brazil" },
      expected,
    });
    attempts.push({ params: { q: [cep, city, state].filter(Boolean).join(", ") }, expected });
  }
  const free = clean(parts.full_address);
  if (free.length > 8) attempts.push({ params: { q: free }, expected: base });
  if (neighborhood && city) {
    attempts.push({
      params: { q: [neighborhood, city, state].filter(Boolean).join(", ") },
      expected: base,
    });
  }

  for (const { params, expected } of attempts) {
    const hasQuery = Object.values(params).some((v) => v.trim().length >= 3);
    if (!hasQuery) continue;
    const coords = await nominatim(params, expected);
    if (coords) return coords;
  }
  return null;
}

/** Compatibilidade: aceita o endereço já montado em texto. */
export async function geocode(address: string | AddressParts): Promise<Coords | null> {
  if (typeof address !== "string") return geocodeParts(address);
  const q = address.trim();
  if (q.length < 5) return null;
  const coords = await nominatim({ q });
  if (coords) return coords;
  // Sem bairro/CEP: remove trechos numéricos de CEP e tenta de novo.
  const withoutCep = q
    .split(",")
    .map((p) => p.trim())
    .filter((p) => !/^\d{5}-?\d{3}$/.test(p) && !/^CEP/i.test(p))
    .join(", ");
  if (withoutCep !== q && withoutCep.length >= 5) return nominatim({ q: withoutCep });
  return null;
}

/** Distância rodoviária na ordem informada, sem volta ao ponto inicial. */
export async function drivingRoute(points: Array<{ label: string; coords: Coords }>): Promise<{
  legs: RouteLeg[];
  totalKm: number;
  totalMinutes: number;
} | null> {
  if (points.length < 2) return { legs: [], totalKm: 0, totalMinutes: 0 };
  const path = points.map((p) => `${p.coords.lon},${p.coords.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=false&annotations=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        legs?: Array<{ distance: number; duration: number }>;
      }>;
    };
    const route = json.routes?.[0];
    if (json.code !== "Ok" || !route) return null;
    const legs: RouteLeg[] = (route.legs ?? []).map((leg, i) => ({
      from: points[i]?.label ?? "",
      to: points[i + 1]?.label ?? "",
      km: Math.round((leg.distance / 1000) * 10) / 10,
      minutes: Math.round(leg.duration / 60),
    }));
    return {
      legs,
      totalKm: Math.round((route.distance / 1000) * 10) / 10,
      totalMinutes: Math.round(route.duration / 60),
    };
  } catch {
    return null;
  }
}

export function buildAddress(parts: {
  street?: string | null;
  street_number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  full_address?: string | null;
}): string {
  const composed = [
    [parts.street, parts.street_number].filter(Boolean).join(", "),
    parts.neighborhood,
    parts.city,
    parts.state,
    parts.postal_code,
  ]
    .filter((v) => v && String(v).trim().length > 0)
    .join(", ");
  return composed.length > 8 ? composed : (parts.full_address ?? "").trim();
}
