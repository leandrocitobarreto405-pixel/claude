import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ipDoPedido,
  lerTextoConfig,
  precisaAceitar,
  validarUrlTermos,
  validarVersao,
} from "./termos";

test("sem versão definida ninguém é perguntado; versão nova pede de novo", () => {
  assert.equal(precisaAceitar(null, []), false);
  assert.equal(precisaAceitar("2026-11", []), true);
  assert.equal(precisaAceitar("2026-11", ["2026-11"]), false);
  assert.equal(precisaAceitar("2027-01", ["2026-11"]), true);
});

test("leitura e validação", () => {
  assert.equal(lerTextoConfig(null), null);
  assert.equal(lerTextoConfig(" v2 "), "v2");
  assert.equal(lerTextoConfig(5), null);
  assert.equal(validarVersao("2026-11"), "2026-11");
  assert.throws(() => validarVersao("versão com espaço"));
  assert.equal(validarUrlTermos("https://exemplo.com/termos"), "https://exemplo.com/termos");
  assert.throws(() => validarUrlTermos("http://exemplo.com"));
  assert.equal(ipDoPedido("203.0.113.5, 10.0.0.1", null), "203.0.113.5");
  assert.equal(ipDoPedido(null, "198.51.100.2"), "198.51.100.2");
  assert.equal(ipDoPedido(null, null), null);
});
