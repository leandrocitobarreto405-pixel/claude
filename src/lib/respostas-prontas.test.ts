import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daChatwoot,
  filtrarRespostas,
  limparAtalho,
  preencherResposta,
  validarRespostas,
} from "./respostas-prontas";

const lista = [
  { id: "1", atalho: "bom-dia", texto: "Bom dia, {nome}! Aqui é {atendente}, da {empresa}." },
  { id: "2", atalho: "pix", texto: "Nosso Pix é o CNPJ da empresa." },
  { id: "3", atalho: "obrigado", texto: "Obrigada pelo contato, tenha um bom dia!" },
];

test("atalho: sem barra, sem acento, sem espaço", () => {
  assert.equal(limparAtalho("/Bom Dia!"), "bom-dia");
  assert.equal(limparAtalho("  Endereço "), "endereco");
});

test("filtra pelo atalho primeiro e depois pelo texto", () => {
  assert.deepEqual(
    filtrarRespostas(lista, "bom").map((r) => r.id),
    ["1", "3"],
  );
  assert.deepEqual(
    filtrarRespostas(lista, "pi").map((r) => r.id),
    ["2"],
  );
  assert.equal(filtrarRespostas(lista, "").length, 3);
});

test("preenche {nome}, {empresa} e {atendente}; sem nome, a frase fica sem ele", () => {
  const v = { nome: "Beatriz", empresa: "Turbine Clean", atendente: "Maria" };
  assert.equal(
    preencherResposta(lista[0]!.texto, v),
    "Bom dia, Beatriz! Aqui é Maria, da Turbine Clean.",
  );
  assert.equal(
    preencherResposta(lista[0]!.texto, { ...v, nome: null }),
    "Bom dia! Aqui é Maria, da Turbine Clean.",
  );
  assert.equal(preencherResposta("Oi {nome}, tudo bem?", { ...v, nome: null }), "Oi, tudo bem?");
});

test("variáveis do Chatwoot viram as do Nexa", () => {
  assert.equal(
    daChatwoot("Olá {{contact.name}}, sou {{ agent.name }} da {{account.name}}"),
    "Olá {nome}, sou {atendente} da {empresa}",
  );
});

test("validação: atalho repetido ou texto vazio são recusados", () => {
  assert.throws(() => validarRespostas([lista[1]!, { ...lista[1]!, id: "x" }]), /repetido/);
  assert.throws(() => validarRespostas([{ id: "a", atalho: "x", texto: " " }]), /sem texto/);
  assert.equal(validarRespostas([{ id: "", atalho: "/Pix", texto: " a " }])[0]!.atalho, "pix");
});
