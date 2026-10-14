import { test } from "node:test";
import assert from "node:assert/strict";
import { precisaNotaPorRegra, regraNota, temCpfOuCnpj, valorDaNota } from "./nota-fiscal-regra";

test("regra: valor desconhecido vira o padrão (cpf_cnpj)", () => {
  assert.equal(regraNota(undefined), "cpf_cnpj");
  assert.equal(regraNota("qualquer"), "cpf_cnpj");
  assert.equal(regraNota("sempre"), "sempre");
  assert.equal(regraNota("nunca"), "nunca");
});

test("CPF ou CNPJ: com ou sem pontuação; vazio ou incompleto não conta", () => {
  assert.equal(temCpfOuCnpj("000.000.000-00"), true);
  assert.equal(temCpfOuCnpj("00000000000"), true);
  assert.equal(temCpfOuCnpj("00.000.000/0000-00"), true);
  assert.equal(temCpfOuCnpj(""), false);
  assert.equal(temCpfOuCnpj(null), false);
  assert.equal(temCpfOuCnpj("123"), false);
});

test("pré-marcação pela regra", () => {
  assert.equal(precisaNotaPorRegra("sempre", null), true);
  assert.equal(precisaNotaPorRegra("nunca", "00000000000"), false);
  assert.equal(precisaNotaPorRegra("cpf_cnpj", "00000000000"), true);
  assert.equal(precisaNotaPorRegra("cpf_cnpj", null), false);
});

test("valor da nota é o total da OS; sem total, o do serviço", () => {
  assert.equal(valorDaNota(900, 300), 900);
  assert.equal(valorDaNota(0, 300), 300);
  assert.equal(valorDaNota(null, 300), 300);
});
