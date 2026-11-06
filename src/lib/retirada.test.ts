import { test } from "node:test";
import assert from "node:assert/strict";
import {
  datasDaVespera,
  diaCurto,
  entregaPrevista,
  itensDaConfirmacao,
  linhaDoPrazo,
  linhasDoPrazo,
  mensagemDaVespera,
  quandoDaVespera,
  somarDiasUteis,
  tipoDaCategoria,
} from "./retirada";

test("retirada: entrega em dias úteis (persiana 7, tapete 15)", () => {
  // Exemplo do plano: retirada qua 04/11 → entrega sex 13/11.
  assert.equal(entregaPrevista("2026-11-04", "persiana"), "2026-11-13");
  assert.equal(diaCurto("2026-11-13"), "sex 13/11");
  // Feriado da empresa no meio (20/11) empurra um dia.
  assert.equal(entregaPrevista("2026-11-16", "persiana"), "2026-11-25");
  assert.equal(entregaPrevista("2026-11-16", "persiana", new Set(["2026-11-20"])), "2026-11-26");
  // Tapete: 15 dias úteis.
  assert.equal(entregaPrevista("2026-11-04", "tapete"), "2026-11-25");
  // Retirada na sexta: o fim de semana não conta.
  assert.equal(somarDiasUteis("2026-11-06", 1, new Set()), "2026-11-09");
});

test("retirada: tipo pela categoria e linha do prazo", () => {
  assert.equal(tipoDaCategoria("persiana"), "persiana");
  assert.equal(tipoDaCategoria("tapete"), "tapete");
  assert.equal(tipoDaCategoria("sofa"), null);
  assert.match(linhaDoPrazo("persiana", 3), /As persianas .* até 7 dias úteis/);
  assert.match(linhaDoPrazo("tapete", 1), /O tapete .* até 15 dias úteis/);
});

test("retirada: confirmação na véspera (datas, quando, itens e texto)", () => {
  assert.deepEqual(datasDaVespera("2026-11-05"), ["2026-11-06"]);
  // Sábado confirma domingo e segunda.
  assert.deepEqual(datasDaVespera("2026-11-07"), ["2026-11-08", "2026-11-09"]);
  assert.equal(quandoDaVespera("2026-11-06", "2026-11-05"), "amanhã (sex 06/11)");
  assert.equal(quandoDaVespera("2026-11-09", "2026-11-07"), "na segunda (09/11)");
  assert.equal(itensDaConfirmacao("persiana", 3), "as 3 persianas");
  assert.equal(itensDaConfirmacao("tapete", 1), "o tapete");
  assert.equal(
    mensagemDaVespera("Retirada", "Ana", "as 3 persianas", "amanhã (sex 06/11)"),
    "Oi, Ana, tudo bem? Tá tudo certo pra gente retirar as 3 persianas amanhã (sex 06/11), dentro do horário comercial, entre 8h e 18h?",
  );
  assert.equal(
    mensagemDaVespera("Entrega", "", "o tapete", "amanhã (qui 19/11)"),
    "Oi, tudo bem? A limpeza ficou pronta! Tá tudo certo pra gente entregar o tapete amanhã (qui 19/11), dentro do horário comercial, entre 8h e 18h?",
  );
});

test("retirada: linhas do prazo no orçamento", () => {
  assert.deepEqual(
    linhasDoPrazo([
      { categoria: "sofa", quantidade: 1 },
      { categoria: "persiana", quantidade: 3 },
      { categoria: "tapete", quantidade: 6.5 },
    ]),
    [
      "As persianas são retiradas e lavadas no nosso galpão, com entrega em até 7 dias úteis após a retirada.",
      "O tapete é retirado e lavado no nosso galpão, com entrega em até 15 dias úteis após a retirada.",
    ],
  );
  assert.deepEqual(linhasDoPrazo([{ categoria: "sofa", quantidade: 2 }]), []);
});
