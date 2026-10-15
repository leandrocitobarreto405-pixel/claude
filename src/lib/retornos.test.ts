import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparRetornos, diaSP, filtrarRetornos, ordenarRetornos } from "./retornos";

const r = (scheduled_at: string, responsavel = "equipe", id = scheduled_at) => ({
  id,
  scheduled_at,
  responsavel,
});

test("dia em São Paulo (não em UTC)", () => {
  // 23h de 13/10 em São Paulo = 02h de 14/10 em UTC: continua 13/10.
  assert.equal(diaSP("2026-10-14T02:30:00Z"), "2026-10-13");
  assert.equal(diaSP("2026-10-13T12:00:00-03:00"), "2026-10-13");
});

test("equipe primeiro, Alice por último, cada um pelo horário", () => {
  const ordem = ordenarRetornos([
    r("2026-10-13T15:00:00Z", "alice", "a2"),
    r("2026-10-13T18:00:00Z", "equipe", "e2"),
    r("2026-10-13T11:00:00Z", "alice", "a1"),
    r("2026-10-13T12:00:00Z", "equipe", "e1"),
  ]).map((x) => x.id);
  assert.deepEqual(ordem, ["e1", "e2", "a1", "a2"]);
});

test("hoje, vencidos (até 3 dias) e próximos pelo dia de São Paulo", () => {
  // Agora: 13/10/2026 às 20h em São Paulo (23h UTC).
  const agora = new Date("2026-10-13T23:00:00Z");
  const g = agruparRetornos(
    [
      r("2026-10-14T01:00:00Z", "equipe", "hoje-noite"), // 22h de 13/10 em SP: ainda hoje
      r("2026-10-13T12:00:00Z", "equipe", "hoje-manha"), // já passou, mas é de hoje
      r("2026-10-12T12:00:00Z", "equipe", "ontem"),
      r("2026-10-11T12:00:00Z", "alice", "anteontem-alice"),
      r("2026-10-09T12:00:00Z", "equipe", "ha-4-dias"), // some da lista
      r("2026-10-14T13:00:00Z", "equipe", "amanha"),
    ],
    agora,
  );
  assert.deepEqual(
    g.hoje.map((x) => x.id),
    ["hoje-manha", "hoje-noite"],
  );
  assert.deepEqual(
    g.vencidos.map((x) => x.id),
    ["ontem", "anteontem-alice"],
  );
  assert.deepEqual(
    g.proximos.map((x) => x.id),
    ["amanha"],
  );
});

test("filtro padrão é a equipe", () => {
  const lista = [r("2026-10-13T12:00:00Z", "equipe"), r("2026-10-13T13:00:00Z", "alice")];
  assert.equal(filtrarRetornos(lista, "equipe").length, 1);
  assert.equal(filtrarRetornos(lista, "alice").length, 1);
  assert.equal(filtrarRetornos(lista, "todas").length, 2);
});
