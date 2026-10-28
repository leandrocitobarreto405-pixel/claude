import { test } from "node:test";
import assert from "node:assert/strict";
import { GRADE_TAXAS, chaveDaLinha, foraDaGrade, rotuloDaLinha } from "./taxas-pagamento";

test("grade com 31 linhas: maquininha 14, link 13 e 4 outras formas", () => {
  assert.deepEqual(
    GRADE_TAXAS.map((g) => g.linhas.length),
    [14, 13, 4],
  );
  const chaves = GRADE_TAXAS.flatMap((g) => g.linhas.map(chaveDaLinha));
  assert.equal(new Set(chaves).size, 31);
  assert.ok(chaves.includes("Maquininha|Crédito|12"));
  assert.ok(chaves.includes("Link de pagamento|Pix|1"));
});

test("rótulos e linhas fora da grade", () => {
  assert.equal(
    rotuloDaLinha({ channel: "Maquininha", payment_type: "Crédito", installments: 3 }),
    "Crédito 3x",
  );
  assert.equal(
    rotuloDaLinha({ channel: "Maquininha", payment_type: "Débito", installments: 1 }),
    "Débito",
  );
  const fora = foraDaGrade([
    { channel: "Maquininha", payment_type: "Débito", installments: 1 },
    { channel: "Boleto", payment_type: "Boleto", installments: 1 },
  ]);
  assert.deepEqual(
    fora.map((r) => r.channel),
    ["Boleto"],
  );
});
