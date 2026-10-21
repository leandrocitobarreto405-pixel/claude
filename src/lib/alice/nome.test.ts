import { test } from "node:test";
import assert from "node:assert/strict";
import { avaliarPerfil, limparNome, linhaDoNome, primeiroNomeLimpo } from "./nome";

test("limpa o nome: maiúscula, partículas, sem emoji e número", () => {
  assert.equal(limparNome("  bEATRIZ   souza "), "Beatriz Souza");
  assert.equal(limparNome("ana de souza"), "Ana de Souza");
  assert.equal(limparNome("carlos 💙"), "Carlos");
  assert.equal(limparNome("123"), "");
  assert.equal(primeiroNomeLimpo("ana paula"), "Ana");
  assert.equal(primeiroNomeLimpo(""), null);
});

test("perfil: casos óbvios não parecem nome; o resto a Alice avalia", () => {
  for (const p of [
    "🌸🌸",
    "Loja da Ana",
    "Ana Imóveis",
    "J.P.",
    "AB",
    "11 98888-0000",
    "",
    "Sou mais Jesus que tudo nesta vida",
  ])
    assert.equal(avaliarPerfil(p), "nao_parece", p);
  for (const p of ["Beatriz", "Carlos Souza", "Ana Paula", "Cacau", "Sou mais Jesus", "Princesa"])
    assert.equal(avaliarPerfil(p), "avaliar", p);
});

test("linha do nome para a Alice: confirmado, a perguntar, perguntar de novo, parar", () => {
  assert.match(
    linhaDoNome({
      confirmado: "beatriz souza",
      origem: "perfil",
      perfil: "Beatriz Souza",
      perguntas: 0,
    }),
    /CONFIRMADO: Beatriz \(nome do perfil aceito\).*não pergunte/,
  );
  assert.match(
    linhaDoNome({ confirmado: null, origem: null, perfil: "Sou mais Jesus", perguntas: 0 }),
    /não confirmado \(nome do perfil do WhatsApp: "Sou mais Jesus", ainda não avaliado/,
  );
  assert.match(
    linhaDoNome({ confirmado: null, origem: null, perfil: "🌸", perguntas: 0 }),
    /NÃO parece nome de pessoa/,
  );
  assert.match(
    linhaDoNome({ confirmado: null, origem: null, perfil: "Cacau", perguntas: 1 }),
    /já perguntou 1 vez: pergunte só mais uma/,
  );
  assert.match(
    linhaDoNome({ confirmado: null, origem: null, perfil: "Cacau", perguntas: 2 }),
    /NÃO pergunte mais e siga sem nome/,
  );
});
