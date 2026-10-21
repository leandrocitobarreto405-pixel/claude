import { test } from "node:test";
import assert from "node:assert/strict";
import { proximoNumero } from "./numeracao-os.functions";

test("próximo número de OS: maior usado + 1 ou o definido no painel, o que for maior", () => {
  assert.equal(proximoNumero(null, null), "0001");
  assert.equal(proximoNumero(3, null), "0004");
  assert.equal(proximoNumero(3, 1500), "1500");
  assert.equal(proximoNumero(1500, 1500), "1501");
  assert.equal(proximoNumero(1693, 100), "1694");
});
