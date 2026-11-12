import { test } from "node:test";
import assert from "node:assert/strict";
import { atalhoDoApressado, jaPerguntouOMotivo, pedeOPreco } from "./atalho";
import type { MensagemHistorico } from "./prompt";

const m = (direcao: "Recebida" | "Enviada", texto: string, foto = false): MensagemHistorico => ({
  direcao,
  texto,
  tipo: foto ? "Imagem" : "Texto",
  remetente: direcao === "Recebida" ? "contact" : "agent_bot",
  imagens: foto ? [{ mediaType: "image/jpeg", base64: "x" }] : [],
});
const c = (t: string, foto = false) => m("Recebida", t, foto);
const a = (t: string) => m("Enviada", t);

test("pedido explícito de preço", () => {
  for (const t of [
    "Quanto fica?",
    "qual o valor",
    "Qual é o preço?",
    "pode mandar",
    "Pode me passar",
    "me passa o orçamento",
    "manda o valor aí",
    "só o preço",
    "queria saber o valor",
    "quanto custa pra higienizar",
    "quanto vocês cobram?",
    "Valor?",
    "orçamento?",
    "quanto sai",
    "preciso de um orçamento",
  ])
    assert.equal(pedeOPreco(t), true, t);
  for (const t of [
    "Oi, tudo bem?",
    "Tenho um sofá de 3 lugares",
    "meu cep é 04567-000",
    "o sofá tem muito valor sentimental",
    "pode ser amanhã",
    "quanto tempo demora?",
    "vocês atendem na Mooca?",
  ])
    assert.equal(pedeOPreco(t), false, t);
});

test("atalho: item + CEP + pedido de preço, na primeira mensagem ou depois", () => {
  // Tudo de uma vez, na primeira mensagem.
  assert.deepEqual(
    atalhoDoApressado([c("Oi, quanto fica pra higienizar um sofá de 3 lugares? CEP 04567-000")]),
    { ativo: true, falta: [] },
  );
  // Em mensagens seguidas, depois da pergunta do motivo que ele ignorou.
  assert.equal(
    atalhoDoApressado([
      c("Oi! Tenho um sofá retrátil de 2 módulos"),
      a("Oi, Bia! Você consegue me mandar uma foto e o seu CEP?"),
      c("04567000"),
      a("O que mais te incomoda no seu sofá hoje, que te fez buscar a higienização?"),
      c("pode mandar o valor"),
    ]).ativo,
    true,
  );
  // Item pela foto e endereço por rua.
  assert.equal(
    atalhoDoApressado([
      c("", true),
      c("moro na rua Vergueiro 1000, Vila Mariana"),
      c("qual o valor?"),
    ]).ativo,
    true,
  );
  // Endereço já conhecido de outro orçamento.
  assert.equal(
    atalhoDoApressado([c("quanto fica o colchão queen?")], { enderecoConhecido: true }).ativo,
    true,
  );
});

test("atalho não vale: falta item, CEP ou o pedido; ou o valor já foi enviado", () => {
  assert.deepEqual(atalhoDoApressado([c("Quanto fica?")]).falta, ["item", "cep"]);
  assert.deepEqual(atalhoDoApressado([c("Quanto fica o sofá de 3 lugares?")]).falta, ["cep"]);
  assert.deepEqual(atalhoDoApressado([c("Tenho um sofá, CEP 04567-000")]).falta, [
    "pedido_de_preco",
  ]);
  // O pedido de preço ficou para trás: a última fala é outra coisa.
  assert.equal(
    atalhoDoApressado([
      c("quanto fica o sofá? cep 04567-000"),
      a("Já te passo! Me conta: ele é retrátil?"),
      c("é sim, de 2 módulos"),
    ]).ativo,
    false,
  );
  // Depois que o valor foi enviado, segue o roteiro normal.
  assert.deepEqual(
    atalhoDoApressado([
      c("quanto fica o sofá? cep 04567-000"),
      a("*Total:* R$ 420,00 em até 3x"),
      c("qual o valor no pix?"),
    ]),
    { ativo: false, falta: null },
  );
  // Última mensagem é da empresa (follow-up): não é resposta ao cliente.
  assert.equal(atalhoDoApressado([c("quanto fica o sofá? cep 04567-000"), a("Oi!")]).ativo, false);
  assert.equal(atalhoDoApressado([]).ativo, false);
});

test("pergunta do motivo: feita uma vez", () => {
  assert.equal(jaPerguntouOMotivo([c("oi"), a("Oi! Me manda uma foto e o CEP?")]), false);
  assert.equal(
    jaPerguntouOMotivo([
      c("oi"),
      a("Pra eu entender o seu problema: o que mais te incomoda no seu sofá hoje?"),
    ]),
    true,
  );
});
