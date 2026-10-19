import { test } from "node:test";
import assert from "node:assert/strict";
import { situacoesEscolhiveis, statusAoSalvar } from "./quote-status";

test("orçamento salvo = enviado; aprovado, recusado e virou OS não mudam", () => {
  assert.equal(statusAoSalvar("rascunho"), "enviado");
  assert.equal(statusAoSalvar(undefined), "enviado");
  assert.equal(statusAoSalvar("enviado"), "enviado");
  assert.equal(statusAoSalvar("aprovado"), "aprovado");
  assert.equal(statusAoSalvar("recusado"), "recusado");
  assert.equal(statusAoSalvar("convertido"), "convertido");
});

test("'virou OS' e rascunho não são escolhidos na mão (só aparecem se já forem a situação)", () => {
  assert.deepEqual(situacoesEscolhiveis("enviado"), ["enviado", "aprovado", "recusado"]);
  assert.deepEqual(situacoesEscolhiveis("convertido"), [
    "convertido",
    "enviado",
    "aprovado",
    "recusado",
  ]);
});
