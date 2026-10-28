import { test } from "node:test";
import assert from "node:assert/strict";
import { comGarantia, dataDaGarantia, textoGarantia } from "./orcamento-garantia";

test("data da garantia: de amanhã até 90 dias", () => {
  assert.deepEqual(dataDaGarantia("2026-12-15", "2026-10-28"), { data: "2026-12-15" });
  assert.ok("erro" in dataDaGarantia("2026-10-28", "2026-10-28"));
  assert.ok("erro" in dataDaGarantia("2027-02-01", "2026-10-28"));
  assert.ok("erro" in dataDaGarantia("15/12/2026", "2026-10-28"));
});

test("mensagem: a linha da validade vira 'Valor garantido até dd/mm.'", () => {
  assert.equal(textoGarantia("2026-12-15"), "Valor garantido até 15/12");
  const modelo = "Total: {total}\nOrçamento válido por {validade} dias.\nPosso reservar?";
  assert.equal(
    comGarantia(modelo, "2026-12-15"),
    "Total: {total}\nValor garantido até 15/12.\nPosso reservar?",
  );
  assert.equal(comGarantia(modelo, null), modelo);
  assert.equal(
    comGarantia("Total: {total}", "2026-12-15"),
    "Total: {total}\nValor garantido até 15/12.",
  );
});
