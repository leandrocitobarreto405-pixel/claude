import { test } from "node:test";
import assert from "node:assert/strict";
import { temEnderecoParaOrcamento } from "./cep-obrigatorio";

test("CEP obrigatório: CEP de 8 dígitos ou rua e bairro", () => {
  assert.equal(temEnderecoParaOrcamento("01310-100", null), true);
  assert.equal(temEnderecoParaOrcamento("0131", null), false);
  assert.equal(temEnderecoParaOrcamento(null, "Rua Fictícia, Bairro Teste"), true);
  assert.equal(temEnderecoParaOrcamento(null, "  "), false);
  assert.equal(temEnderecoParaOrcamento(null, "123"), false);
  assert.equal(temEnderecoParaOrcamento(null, null), false);
});
