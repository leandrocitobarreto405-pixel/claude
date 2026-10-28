import { test } from "node:test";
import assert from "node:assert/strict";
import { MOTIVO_IA, rotuloTemperatura, seloRetorno, veioDaIa } from "./temperatura";

test("rótulos: Quente, Morno e Frio; valor estranho vira Frio", () => {
  assert.equal(rotuloTemperatura("QUENTE"), "Quente");
  assert.equal(rotuloTemperatura("MORNO"), "Morno");
  assert.equal(rotuloTemperatura("FRIO"), "Frio");
  assert.equal(rotuloTemperatura("x"), "Frio");
  assert.equal(rotuloTemperatura(null), "Frio");
});

test("selo do retorno: dia de São Paulo e vencido quando já passou", () => {
  const agora = new Date("2026-10-28T15:00:00Z");
  assert.deepEqual(seloRetorno("2026-11-16T13:00:00Z", agora), {
    rotulo: "Retorno combinado (16/11)",
    vencido: false,
  });
  // 01:00Z do dia 29 ainda é dia 28 em São Paulo.
  assert.equal(seloRetorno("2026-10-29T01:00:00Z", agora)?.rotulo, "Retorno combinado (28/10)");
  assert.equal(seloRetorno("2026-10-25T13:00:00Z", agora)?.vencido, true);
  assert.equal(seloRetorno(null, agora), null);
});

test("(IA) só quando nenhuma regra decidiu", () => {
  assert.equal(veioDaIa(MOTIVO_IA), true);
  assert.equal(veioDaIa(null), true);
  assert.equal(veioDaIa("Respondeu nas últimas 48 h depois do orçamento"), false);
});
