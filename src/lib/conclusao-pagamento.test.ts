import { test } from "node:test";
import assert from "node:assert/strict";
import { erroDoPagamento, STATUS_DA_LINHA, valorInicialDaParte } from "./conclusao-pagamento";

test("sem escolha não conclui", () => {
  assert.match(erroDoPagamento({ escolha: null, soma: 0, valor: 300, limite: 300 })!, /Escolha/);
});

test("ainda não pagou: conclui sem valor", () => {
  assert.equal(erroDoPagamento({ escolha: "nao", soma: 0, valor: 300, limite: 300 }), null);
});

test("pago: a soma tem de ser o valor do serviço (e caber no limite)", () => {
  assert.equal(erroDoPagamento({ escolha: "pago", soma: 300, valor: 300, limite: 300 }), null);
  assert.match(erroDoPagamento({ escolha: "pago", soma: 0, valor: 300, limite: 300 })!, /Informe/);
  assert.match(
    erroDoPagamento({ escolha: "pago", soma: 200, valor: 300, limite: 300 })!,
    /Pago em parte/,
  );
  assert.match(
    erroDoPagamento({ escolha: "pago", soma: 400, valor: 300, limite: 300 })!,
    /ultrapassa/,
  );
  // Visita que cobra a OS inteira: o limite é o total da OS.
  assert.equal(erroDoPagamento({ escolha: "pago", soma: 900, valor: 900, limite: 900 }), null);
});

test("pago em parte: maior que zero e menor que o valor", () => {
  assert.equal(erroDoPagamento({ escolha: "parte", soma: 100, valor: 300, limite: 300 }), null);
  assert.match(
    erroDoPagamento({ escolha: "parte", soma: 300, valor: 300, limite: 300 })!,
    /Escolha "Pago"/,
  );
  assert.match(erroDoPagamento({ escolha: "parte", soma: 0, valor: 300, limite: 300 })!, /Informe/);
});

test("toda linha nasce Pago; só em Pago o valor vem preenchido", () => {
  assert.equal(STATUS_DA_LINHA, "Pago");
  assert.equal(valorInicialDaParte("pago", 249.9), "249,90");
  assert.equal(valorInicialDaParte("parte", 249.9), "");
  assert.equal(valorInicialDaParte("nao", 249.9), "");
});
