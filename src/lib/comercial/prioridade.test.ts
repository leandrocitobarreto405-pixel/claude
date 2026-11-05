import { test } from "node:test";
import assert from "node:assert/strict";
import { contarPorNivel, nivelDaTarefa, prazoDaTarefa, tarefaAtrasada } from "./prioridade";

test("prioridade: P1, P2 e P3 pelo número gravado na tarefa", () => {
  assert.equal(nivelDaTarefa(0), 1);
  assert.equal(nivelDaTarefa(1), 1);
  assert.equal(nivelDaTarefa(2), 2);
  assert.equal(nivelDaTarefa(3), 3);
  assert.equal(nivelDaTarefa(5), 3);
  assert.equal(nivelDaTarefa(null), 3);
});

test("prioridade: prazo e atraso", () => {
  assert.equal(prazoDaTarefa(1, "2026-11-05T12:00:00Z", "2026-11-05"), "hoje de manhã");
  assert.equal(prazoDaTarefa(2, "2026-11-05T12:00:00Z", "2026-11-05"), "hoje");
  assert.equal(prazoDaTarefa(3, "2026-11-07T12:00:00Z", "2026-11-05"), "dia 07/11");
  assert.equal(prazoDaTarefa(3, "2026-11-04T12:00:00Z", "2026-11-05"), "hoje");
  assert.equal(tarefaAtrasada("2026-11-04T12:00:00Z", "2026-11-05", 0), true);
  assert.equal(tarefaAtrasada("2026-11-05T12:00:00Z", "2026-11-05", 0), false);
  assert.equal(tarefaAtrasada("2026-11-05T12:00:00Z", "2026-11-05", 1), true);
  assert.deepEqual(
    contarPorNivel(
      [
        { prioridade: 1, quando: "2026-11-05T12:00:00Z", adiamentos: 0 },
        { prioridade: 2, quando: "2026-11-04T12:00:00Z", adiamentos: 0 },
        { prioridade: 3, quando: "2026-11-05T12:00:00Z", adiamentos: 0 },
      ],
      "2026-11-05",
    ),
    { p1: 1, p2: 1, p3: 1, atrasadas: 1 },
  );
});
