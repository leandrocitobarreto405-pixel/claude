import { test } from "node:test";
import assert from "node:assert/strict";
import { problemaDaSenha } from "./senha";

test("senha: 8 caracteres, letra e número", () => {
  assert.match(problemaDaSenha("abc123")!, /8 caracteres/);
  assert.match(problemaDaSenha("12345678")!, /letra/);
  assert.match(problemaDaSenha("abcdefgh")!, /número/);
  assert.equal(problemaDaSenha("limpeza2026"), null);
  assert.equal(problemaDaSenha("Ação1234"), null);
});
