// Campos do roteiro-base da Alice: troca, campo vazio e bloqueio para ligar. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarCamposDoRoteiro,
  CAMPO_VAZIO,
  camposFaltando,
  limparCampos,
} from "./campos-roteiro";

const roteiro =
  "Bem-vindo(a) à {nome_empresa}! Atendemos a {regiao_atendida}, do jeito que {nomes_atendentes} fazem. Técnico com mais de {anos_experiencia} anos.";
const campos = {
  regiao_atendida: "Região X",
  nomes_atendentes: "a Ana e a Bia",
  anos_experiencia: "7",
};

test("troca o nome da empresa e os campos", () => {
  assert.equal(
    aplicarCamposDoRoteiro(roteiro, "Empresa Teste", campos),
    "Bem-vindo(a) à Empresa Teste! Atendemos a Região X, do jeito que a Ana e a Bia fazem. Técnico com mais de 7 anos.",
  );
});

test("campo vazio: a Alice lê que não deve citar", () => {
  const t = aplicarCamposDoRoteiro(roteiro, "E", { ...campos, anos_experiencia: " " });
  assert.ok(t.includes(`mais de ${CAMPO_VAZIO} anos`));
});

test("texto sem marcador fica igual (roteiro antigo)", () => {
  assert.equal(aplicarCamposDoRoteiro("Sem marcador.", "E", campos), "Sem marcador.");
});

test("campos usados e vazios bloqueiam ligar; tamanho conferido", () => {
  assert.deepEqual(camposFaltando(roteiro, { ...campos, regiao_atendida: "" }), [
    "Região atendida",
  ]);
  assert.deepEqual(camposFaltando("Sem marcador.", limparCampos({})), []);
  assert.throws(() => limparCampos({ anos_experiencia: "12345678901" }), /no máximo 10/);
  assert.deepEqual(limparCampos({ regiao_atendida: "  X  " }).regiao_atendida, "X");
});
