// Número do orçamento: 4 dígitos na tela; busca pelo número novo e, de antes, pelo id curto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acharOrcamento, formatarNumeroOrcamento, lerNumeroOrcamento } from "./numero-orcamento";

test("exibição com 4 dígitos", () => {
  assert.equal(formatarNumeroOrcamento(153), "0153");
  assert.equal(formatarNumeroOrcamento(1), "0001");
  assert.equal(formatarNumeroOrcamento(12345), "12345");
  assert.equal(formatarNumeroOrcamento(null, "3fa2b1c9-0000-0000-0000-000000000000"), "3fa2b1c9");
});

test("leitura do que foi digitado", () => {
  for (const t of ["153", "0153", "Nº 0153", "nº153", "#153", " N° 0153 "])
    assert.equal(lerNumeroOrcamento(t), 153, t);
  assert.equal(lerNumeroOrcamento("3fa2b1c9"), null);
  assert.equal(lerNumeroOrcamento("0"), null);
  assert.equal(lerNumeroOrcamento(""), null);
});

test("busca: número novo primeiro, id curto antigo como reserva", () => {
  const lista = [
    { id: "0153abcd-0000-0000-0000-000000000000", numero: 7 },
    { id: "3fa2b1c9-0000-0000-0000-000000000000", numero: 153 },
  ];
  // "0153" é número 153 (não o id que começa com 0153).
  assert.equal(acharOrcamento(lista, "0153")?.numero, 153);
  assert.equal(acharOrcamento(lista, "Nº 0007")?.numero, 7);
  // Conversa antiga com o id curto.
  assert.equal(acharOrcamento(lista, "3fa2b1c9")?.numero, 153);
  // Número que não existe, mas é começo de id: cai no id.
  assert.equal(acharOrcamento(lista, "0153abcd")?.numero, 7);
  assert.equal(acharOrcamento(lista, "9999"), null);
});
