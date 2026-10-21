import { test } from "node:test";
import assert from "node:assert/strict";
import { TRECHOS_NOME_TURBINE, aplicarRoteiroNome } from "./nome-roteiro";

test("roteiro: troca os três trechos e mantém o resto", () => {
  const original = ["# Começo", ...TRECHOS_NOME_TURBINE.map((t) => t.antes), "# Fim"].join("\n");
  const novo = aplicarRoteiroNome(original);
  for (const t of TRECHOS_NOME_TURBINE) {
    assert.ok(!novo.includes(t.antes) || t.depois.includes(t.antes), t.titulo);
    assert.ok(novo.includes(t.depois), t.titulo);
  }
  assert.ok(novo.startsWith("# Começo") && novo.endsWith("# Fim"));
  assert.match(novo, /Com quem eu falo\?/);
});

test("roteiro: trecho ausente não muda nada", () => {
  assert.throws(() => aplicarRoteiroNome("roteiro sem os trechos"), /nada foi alterado/);
});
