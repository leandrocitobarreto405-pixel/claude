import { test } from "node:test";
import assert from "node:assert/strict";
import { CENARIOS_RESPOSTAS, conferirRespostas } from "./ensaio-respostas.server";

test("ensaio: conversas reproduzidas sem telefone nem endereço reais", () => {
  const texto = JSON.stringify(CENARIOS_RESPOSTAS);
  assert.doesNotMatch(texto, /\b9\d{4}-?\d{4}\b|\+55/); // telefone
  // Nomes inventados; endereço só com bairro e CEP genérico.
  assert.deepEqual(
    CENARIOS_RESPOSTAS.map((c) => c.nome),
    ["Rafael", "Bruna"],
  );
  for (const c of CENARIOS_RESPOSTAS)
    assert.equal(c.historico.at(-1)!.de, "cliente", `${c.id} termina no cliente`);
});

test("ensaio 3615: pergunta das almofadas de novo é problema", () => {
  assert.equal(
    conferirRespostas("final-3615", "Dá pra tirar as almofadas do lugar?", []).passou,
    false,
  );
  assert.equal(
    conferirRespostas("final-3615", "Anotado, almofadas fixas! Vou montar seu orçamento.", [])
      .passou,
    true,
  );
  assert.equal(
    conferirRespostas("final-3615", "ok", [
      { nome: "criar_orcamento", entrada: { itens: [{ almofadas_soltas: true }] } },
    ]).motivo,
    "marcou almofadas soltas",
  );
});

test("ensaio 7010: transferir ou falar de classe é problema", () => {
  assert.equal(
    conferirRespostas("final-7010", "Vou chamar a especialista", [
      { nome: "transferir_para_humano", entrada: {} },
    ]).motivo,
    "passou para a equipe",
  );
  assert.equal(
    conferirRespostas("final-7010", "Considerei a categoria B", [
      { nome: "criar_orcamento", entrada: {} },
    ]).motivo,
    "falou de classe/categoria",
  );
  assert.equal(
    conferirRespostas("final-7010", "Consegue tirar uma foto de pertinho do tecido?", []).motivo,
    "pediu foto do tecido",
  );
  assert.equal(
    conferirRespostas("final-7010", "O técnico confere o tecido no local 💙", [
      { nome: "criar_orcamento", entrada: {} },
    ]).passou,
    true,
  );
});
