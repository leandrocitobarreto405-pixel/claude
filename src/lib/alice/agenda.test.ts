import { test } from "node:test";
import assert from "node:assert/strict";
import { agendaLivre, diasAtendidos, textoAgenda } from "./agenda";
import type { HorarioBase } from "@/lib/promocao";

// Josué: seg/qua/sex 10h e 14h, ter 11h e 14h, qui 9h e 14h, sáb 9h e 14h.
const J = { tecnicoId: "j", tecnico: "Josué Barreto" };
const BASE: HorarioBase[] = [
  ...[1, 3, 5].flatMap((d) => ["10:00", "14:00"].map((hora) => ({ ...J, diaSemana: d, hora }))),
  ...["11:00", "14:00"].map((hora) => ({ ...J, diaSemana: 2, hora })),
  ...["09:00", "14:00"].map((hora) => ({ ...J, diaSemana: 4, hora })),
  ...["09:00", "14:00"].map((hora) => ({ ...J, diaSemana: 6, hora })),
];
const CLIENTE = { lat: -23.55, lon: -46.63 };
// 2026-10-07 é quarta.
const AGORA = { data: "2026-10-07", hora: "08:00" };

test("dias atendidos e texto sem domingo", () => {
  assert.deepEqual(diasAtendidos(BASE), [1, 2, 3, 4, 5, 6]);
  const t = textoAgenda(BASE, [], "qualquer");
  assert.match(t, /Sem horário \(não ofereça nem pergunte\): domingo/);
  assert.match(textoAgenda([], [], "qualquer"), /não tem horários cadastrados/);
});

test("horários livres: ocupados, preferência, folga de hoje e domingo fora", () => {
  const dias = agendaLivre({
    inicio: "2026-10-07",
    dias: 5, // qua, qui, sex, sáb, dom
    base: BASE,
    ocupacoes: [
      { tecnicoId: "j", hora: "10:00", status: "Agendado", data: "2026-10-09", coords: null },
      { tecnicoId: "j", hora: "14:00", status: "Cancelado", data: "2026-10-09", coords: null },
    ],
    periodo: "qualquer",
    agora: { data: "2026-10-07", hora: "08:00" },
    cliente: null,
  });
  const mapa = Object.fromEntries(dias.map((d) => [d.data, d.livres.map((h) => h.hora)]));
  // Hoje (qua) às 8h: 10h tem só 2 h de folga (fora); 14h entra.
  assert.deepEqual(mapa["2026-10-07"], ["14:00"]);
  assert.deepEqual(mapa["2026-10-08"], ["09:00", "14:00"]);
  // Sexta: 10h ocupada; o cancelado não ocupa.
  assert.deepEqual(mapa["2026-10-09"], ["14:00"]);
  assert.deepEqual(mapa["2026-10-10"], ["09:00", "14:00"]);
  assert.equal(mapa["2026-10-11"], undefined, "domingo sem horário");

  const manha = agendaLivre({
    inicio: "2026-10-08",
    dias: 3,
    base: BASE,
    ocupacoes: [],
    periodo: "manha",
    agora: AGORA,
    cliente: null,
  });
  assert.deepEqual(
    manha.map((d) => `${d.data} ${d.livres.map((h) => h.hora).join(",")}`),
    ["2026-10-08 09:00", "2026-10-09 10:00", "2026-10-10 09:00"],
  );
});

test("prioriza o dia em que o técnico já tem serviço perto do cliente", () => {
  const dias = agendaLivre({
    inicio: "2026-10-08",
    dias: 3,
    base: BASE,
    ocupacoes: [
      // Sábado de manhã, a ~1,1 km do cliente.
      {
        tecnicoId: "j",
        hora: "09:00",
        status: "Confirmado",
        data: "2026-10-10",
        coords: { lat: -23.56, lon: -46.63 },
      },
      // Quinta, longe (~30 km).
      {
        tecnicoId: "j",
        hora: "09:00",
        status: "Agendado",
        data: "2026-10-08",
        coords: { lat: -23.3, lon: -46.6 },
      },
    ],
    periodo: "qualquer",
    agora: AGORA,
    cliente: CLIENTE,
  });
  assert.equal(dias[0]!.data, "2026-10-10");
  assert.equal(dias[0]!.pertoKm, 1.1);
  assert.deepEqual(
    dias[0]!.livres.map((h) => h.hora),
    ["14:00"],
  );
  assert.equal(dias[1]!.data, "2026-10-08");
  assert.equal(dias[1]!.pertoKm, null);
  const t = textoAgenda(BASE, dias, "qualquer");
  assert.match(
    t,
    /sábado 10\/10 \(2026-10-10\): 14:00 \(Josué Barreto\) · PERTO: o técnico já tem serviço a 1,1 km/,
  );
});
