// Quem vendeu (decisão E): gravado na OS ou, sem ele, pela vendedora. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarQuemVendeu, resumoPorEquipe, temVendaDaNexa, vendidaPelaNexa } from "./vendido-por";

const lista = [
  { id: 1, vendido_por: "nexa", total_gross_value: 300 },
  { id: 2, vendido_por: "empresa", vendedora: { atendente_nexa: true }, total_gross_value: 200 },
  { id: 3, vendido_por: null, vendedora: { atendente_nexa: true }, total_gross_value: 100 },
  { id: 4, vendido_por: null, vendedora: null, total_gross_value: 50 },
  { id: 5, vendido_por: "nexa", total_gross_value: 999, eh_teste: true },
  { id: 6, vendido_por: "nexa", total_gross_value: 999, status: "Cancelada" },
];

test("o gravado na OS vale; sem ele, a vendedora", () => {
  assert.equal(vendidaPelaNexa(lista[0]), true);
  assert.equal(vendidaPelaNexa(lista[1]), false);
  assert.equal(vendidaPelaNexa(lista[2]), true);
  assert.equal(vendidaPelaNexa(lista[3]), false);
});

test("filtro e separação só com venda da Nexa", () => {
  assert.deepEqual(
    filtrarQuemVendeu(lista.slice(0, 4), "nexa").map((o) => o.id),
    [1, 3],
  );
  assert.deepEqual(
    filtrarQuemVendeu(lista.slice(0, 4), "empresa").map((o) => o.id),
    [2, 4],
  );
  assert.equal(filtrarQuemVendeu(lista, "todas").length, 6);
  assert.equal(temVendaDaNexa([lista[1]!, lista[3]!]), false);
});

test("resumo por equipe sem teste e cancelada", () => {
  assert.deepEqual(resumoPorEquipe(lista), {
    nexa: { os: 2, valor: 400 },
    empresa: { os: 2, valor: 250 },
  });
});
