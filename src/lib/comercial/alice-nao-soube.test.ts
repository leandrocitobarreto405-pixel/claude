import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESQUEMA_NAO_SOUBE,
  TIPO_NAO_SOUBE,
  aliceAdmitiuNaoSaber,
  instrucoesNaoSoube,
  passagemDeRegra,
} from "./alice-nao-soube";

test("não soube: passagem por regra da empresa fica fora", () => {
  assert.equal(passagemDeRegra("Fora da área de atendimento"), true);
  assert.equal(passagemDeRegra("combo com 5 itens"), true);
  assert.equal(passagemDeRegra("cliente pediu desconto"), true);
  assert.equal(passagemDeRegra("cliente pediu atendente humano"), true);
  assert.equal(passagemDeRegra("pós-venda: mancha voltou"), true);
});

test("não soube: passagem por falta de conhecimento entra", () => {
  assert.equal(passagemDeRegra("item fora da tabela: sofá em L"), false);
  assert.equal(passagemDeRegra("persiana maior que 2 m"), false);
  assert.equal(passagemDeRegra("dúvida sobre mofo"), false);
});

test("não soube: reconhece quando a Alice admite não saber", () => {
  assert.equal(aliceAdmitiuNaoSaber("Quem confirma isso direitinho é a especialista 😊"), true);
  assert.equal(aliceAdmitiuNaoSaber("A especialista confirma o prazo pra você"), true);
  assert.equal(aliceAdmitiuNaoSaber("Não tenho essa informação agora"), true);
  assert.equal(aliceAdmitiuNaoSaber("Vou confirmar com a equipe e já te falo"), true);
  assert.equal(aliceAdmitiuNaoSaber("O valor fica R$ 289,00 no Pix"), false);
  assert.equal(aliceAdmitiuNaoSaber(null), false);
});

test("não soube: esquema pede os casos por número e o antes/depois", () => {
  const g = ESQUEMA_NAO_SOUBE.properties.grupos.items;
  assert.deepEqual(g.required, ["assunto", "casos", "onde", "antes", "depois", "pergunta_ao_dono"]);
  assert.equal(g.properties.casos.items.type, "integer");
  assert.equal(TIPO_NAO_SOUBE, "alice_nao_soube");
});

test("não soube: instruções mandam não inventar e não escrever dado de cliente", () => {
  const t = instrucoesNaoSoube("Empresa X");
  assert.ok(t.includes("Empresa X"));
  assert.ok(t.includes("não invente"));
  assert.ok(t.includes("Nunca escreva nome"));
});
