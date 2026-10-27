import { test } from "node:test";
import assert from "node:assert/strict";
import { ehMotivoConcorrencia } from "./concorrencia.server";

test("motivo da transferência que vira aviso urgente de concorrência", () => {
  assert.equal(ehMotivoConcorrencia("concorrência"), true);
  assert.equal(ehMotivoConcorrencia("Concorrencia (achou mais barato)"), true);
  assert.equal(ehMotivoConcorrencia("vai fechar com outra empresa"), true);
  assert.equal(ehMotivoConcorrencia("achou mais barato"), true);
  assert.equal(ehMotivoConcorrencia("desconto"), false);
  assert.equal(ehMotivoConcorrencia("encaixe na agenda"), false);
});
