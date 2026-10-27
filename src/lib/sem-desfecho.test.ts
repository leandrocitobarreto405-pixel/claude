import { test } from "node:test";
import assert from "node:assert/strict";
import { MOTIVOS_SEM_DESFECHO, rotuloServico, sugestaoDaAlice } from "./sem-desfecho";

test("os 11 motivos padrão", () => {
  assert.equal(MOTIVOS_SEM_DESFECHO.length, 11);
  assert.ok(MOTIVOS_SEM_DESFECHO.includes("Preço alto – desistiu/adiou"));
});

test("Alice: preço alto separa desistiu de outra empresa", () => {
  assert.equal(sugestaoDaAlice("Preço", "achou caro, vai pensar"), "Preço alto – desistiu/adiou");
  assert.equal(
    sugestaoDaAlice("Preço", "fechou com outra empresa mais barata"),
    "Preço alto – fechou com outra empresa",
  );
  assert.equal(
    sugestaoDaAlice("Fechou com outra empresa", "o preço lá foi menor"),
    "Preço alto – fechou com outra empresa",
  );
  assert.equal(
    sugestaoDaAlice("Fechou com outra empresa"),
    "Fechou com outra empresa (motivo não informado)",
  );
});

test("Alice: os outros motivos e a escolha explícita", () => {
  assert.equal(sugestaoDaAlice("Sumiu sem responder"), "Não respondeu depois dos follow-ups");
  assert.equal(sugestaoDaAlice("Adiou"), "Adiou");
  assert.equal(sugestaoDaAlice("Não precisa mais", null, "Só cotando"), "Só cotando");
  // Duplicado/teste não é sugestão da Alice: cai na tradução.
  assert.equal(sugestaoDaAlice("Fora da área", null, "Duplicado/teste"), "Fora da área");
});

test("rótulo do serviço no relatório", () => {
  assert.equal(rotuloServico("higienizacao"), "Higienização");
  assert.equal(
    rotuloServico("higienizacao, impermeabilizacao"),
    "Higienização + Impermeabilização",
  );
  assert.equal(rotuloServico(null), "Sem serviço");
});
