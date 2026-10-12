import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoriaDeLimpeza,
  lerQuantidade,
  normalizarQuantidade,
  rotuloServico,
  textoQuantidade,
  unidadeDaCategoria,
} from "./unidade";

test("tapete é por m²; persiana e estofados por peça", () => {
  assert.equal(unidadeDaCategoria("tapete"), "m2");
  assert.equal(unidadeDaCategoria("persiana"), "un");
  assert.equal(unidadeDaCategoria("sofa"), "un");
  assert.equal(unidadeDaCategoria(null), "un");
  assert.equal(categoriaDeLimpeza("tapete"), true);
  assert.equal(categoriaDeLimpeza("persiana"), true);
  assert.equal(categoriaDeLimpeza("colchao"), false);
});

test("medidas viram m²: 1,6 x 2,3 = 3,68", () => {
  assert.equal(lerQuantidade("1,6 x 2,3"), 3.68);
  assert.equal(lerQuantidade("1.6×2.3"), 3.68);
  assert.equal(lerQuantidade("3,68"), 3.68);
  assert.equal(lerQuantidade("3,68 m²"), 3.68);
  assert.equal(lerQuantidade("abc"), null);
  assert.equal(lerQuantidade("0"), null);
});

test("quantidade: m² com 2 casas; peça sempre inteira", () => {
  assert.equal(normalizarQuantidade(3.684, "m2"), 3.68);
  assert.equal(normalizarQuantidade(0, "m2"), 1);
  assert.equal(normalizarQuantidade(2.6, "un"), 3);
  assert.equal(normalizarQuantidade(0, "un"), 1);
});

test("texto: 3,68 m² / 2x; serviço de tapete e persiana é limpeza", () => {
  assert.equal(textoQuantidade(3.68, "m2"), "3,68 m²");
  assert.equal(textoQuantidade(2, "un"), "2x");
  assert.equal(rotuloServico("higienizacao", "tapete"), "Limpeza");
  assert.equal(rotuloServico("higienizacao", "persiana"), "Limpeza");
  assert.equal(rotuloServico("higienizacao", "sofa"), "Higienização");
  assert.equal(rotuloServico("impermeabilizacao", "tapete"), "Impermeabilização");
});
