import { test } from "node:test";
import assert from "node:assert/strict";
import { ERRO_REDE, ERRO_TELA, mensagemParaTela, textoDoErro } from "./erro-tela";

test("erro técnico em inglês vira português; os nossos passam", () => {
  assert.equal(
    mensagemParaTela("Cannot read properties of undefined (reading 'marcados')"),
    ERRO_TELA,
  );
  assert.equal(mensagemParaTela("x.map is not a function"), ERRO_TELA);
  assert.equal(
    mensagemParaTela("Unexpected token '<', \"<!doctype \" is not valid JSON"),
    ERRO_TELA,
  );
  assert.equal(mensagemParaTela("TypeError: Failed to fetch"), ERRO_REDE);
  assert.equal(mensagemParaTela("Load failed"), ERRO_REDE);
  assert.equal(
    mensagemParaTela("Só o administrador marca contatos."),
    "Só o administrador marca contatos.",
  );
  assert.equal(mensagemParaTela(""), ERRO_TELA);
  assert.equal(
    textoDoErro(new TypeError("Cannot read properties of null (reading 'id')")),
    ERRO_TELA,
  );
  assert.equal(
    textoDoErro(new Error("Campanha bloqueada: modelo não aprovado")),
    "Campanha bloqueada: modelo não aprovado",
  );
  assert.equal(textoDoErro(42, "Falhou."), "Falhou.");
});
