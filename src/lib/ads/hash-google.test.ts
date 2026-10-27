import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashEmail, hashTelefone, normalizarEmail, normalizarTelefone } from "./hash-google";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

test("e-mail: minúsculo, sem espaços; gmail sem pontos e sem +sufixo", () => {
  assert.equal(normalizarEmail("  Fulano.Exemplo+loja@Gmail.com "), "fulanoexemplo@gmail.com");
  assert.equal(
    normalizarEmail("Nome.Sobrenome+X@Exemplo.com.br"),
    "nome.sobrenome+x@exemplo.com.br",
  );
  assert.equal(normalizarEmail("sem-arroba"), null);
  assert.equal(normalizarEmail(""), null);
  assert.equal(hashEmail("A@Exemplo.com"), sha("a@exemplo.com"));
  assert.match(hashEmail("a@exemplo.com")!, /^[0-9a-f]{64}$/);
});

test("telefone: E.164 do Brasil, com o nono dígito do celular", () => {
  assert.equal(normalizarTelefone("(11) 98765-4321"), "+5511987654321");
  assert.equal(normalizarTelefone("5511987654321"), "+5511987654321");
  // WhatsApp antigo sem o 9: ganha o 9 (celular começa com 6 a 9)
  assert.equal(normalizarTelefone("551187654321"), "+5511987654321");
  // fixo continua com 8 dígitos
  assert.equal(normalizarTelefone("551132345678"), "+551132345678");
  assert.equal(normalizarTelefone("+1 650 555 0100"), "+16505550100");
  assert.equal(normalizarTelefone("123"), null);
  assert.equal(hashTelefone("11987654321"), sha("+5511987654321"));
});
