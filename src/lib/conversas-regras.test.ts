import { test } from "node:test";
import assert from "node:assert/strict";
import { semRespostaHaMuito } from "./conversas";

test("destaque de 'sem resposta' a partir de 24 h", () => {
  const agora = new Date("2026-10-21T12:00:00Z");
  assert.equal(semRespostaHaMuito(null, agora), false);
  assert.equal(semRespostaHaMuito("2026-10-21T10:00:00Z", agora), false);
  assert.equal(semRespostaHaMuito("2026-10-20T11:59:00Z", agora), true);
});
