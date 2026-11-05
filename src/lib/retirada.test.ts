import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diaCurto,
  entregaPrevista,
  linhaDoPrazo,
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
