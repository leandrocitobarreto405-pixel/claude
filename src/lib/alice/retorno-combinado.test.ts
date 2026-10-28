import { test } from "node:test";
import assert from "node:assert/strict";
import { FRASE_RETORNO_PADRAO, limparFraseRetorno, modeloDoRetorno } from "./retorno-combinado";

test("frase do retorno: uma linha, até 120 caracteres, sem preço nem link, termina com ?", () => {
  assert.equal(
    limparFraseRetorno(
      '"Conseguiu conversar com o seu marido sobre a impermeabilização da poltrona?"',
    ),
    "Conseguiu conversar com o seu marido sobre a impermeabilização da poltrona?",
  );
  assert.equal(
    limparFraseRetorno("Deu tudo certo com a mudança.\n\tE a obra?"),
    "Deu tudo certo com a mudança. E a obra?",
  );
  assert.equal(
    limparFraseRetorno("Deu tudo certo com a mudança!"),
    "Deu tudo certo com a mudança?",
  );
  assert.equal(limparFraseRetorno("Ainda quer pelo valor de R$ 328,00?"), FRASE_RETORNO_PADRAO);
  assert.equal(limparFraseRetorno("Viu o site www.exemplo.com?"), FRASE_RETORNO_PADRAO);
  assert.equal(limparFraseRetorno("a ".repeat(70)), FRASE_RETORNO_PADRAO);
  assert.equal(limparFraseRetorno(""), FRASE_RETORNO_PADRAO);
  assert.equal(limparFraseRetorno(null), FRASE_RETORNO_PADRAO);
});

test("com nome: fu_retorno_combinado (nome, frase); sem nome: _sn (frase)", () => {
  assert.deepEqual(modeloDoRetorno("Juliana", "Deu tudo certo?"), {
    modelo: "fu_retorno_combinado",
    valores: ["Juliana", "Deu tudo certo?"],
  });
  assert.deepEqual(modeloDoRetorno(null, "Deu tudo certo?"), {
    modelo: "fu_retorno_combinado_sn",
    valores: ["Deu tudo certo?"],
  });
});
