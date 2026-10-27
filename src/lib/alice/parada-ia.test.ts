import { test } from "node:test";
import assert from "node:assert/strict";
import {
  causaDaParadaIa,
  causaDaParadaVoz,
  corpoParadaNexa,
  duracaoDaParada,
  horaDaParada,
  notaParadaConversa,
  tituloParadaNexa,
} from "./parada-ia";

test("erro de crédito da IA (o de 12 a 19/10) para a Alice", () => {
  const e = Object.assign(
    new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
    ),
    { status: 400, type: "invalid_request_error" },
  );
  assert.equal(causaDaParadaIa(e), "credito");
  assert.equal(causaDaParadaIa({ status: 400, type: "billing_error", message: "x" }), "credito");
  assert.equal(causaDaParadaIa({ status: 402, message: "Payment required" }), "credito");
});

test("chave recusada da IA para a Alice", () => {
  assert.equal(
    causaDaParadaIa({ status: 401, type: "authentication_error", message: "invalid x-api-key" }),
    "autenticacao",
  );
});

test("lentidão, limite por minuto e erro comum não são parada", () => {
  assert.equal(causaDaParadaIa({ status: 429, type: "rate_limit_error", message: "x" }), null);
  assert.equal(causaDaParadaIa({ status: 529, type: "overloaded_error", message: "x" }), null);
  assert.equal(causaDaParadaIa(new Error("Chatwoot respondeu 500")), null);
  assert.equal(causaDaParadaIa(null), null);
});

test("voz: sem crédito ou chave recusada; demora não", () => {
  assert.equal(causaDaParadaVoz("ElevenLabs respondeu 401 (401): quota_exceeded"), "credito");
  assert.equal(causaDaParadaVoz("ElevenLabs respondeu 401 (401): Invalid API key"), "autenticacao");
  assert.equal(causaDaParadaVoz("ElevenLabs demorou mais de 20 s"), null);
  assert.equal(
    causaDaParadaVoz("ElevenLabs muitos pedidos seguidos ou limite do plano (429): x"),
    null,
  );
});

test("textos dos avisos", () => {
  const agora = new Date("2026-10-27T18:00:00Z");
  const desde = new Date("2026-10-27T17:05:00Z"); // 14:05 em São Paulo
  assert.equal(
    tituloParadaNexa("ia", "credito", desde, agora),
    "Alice parada: sem crédito na conta da IA desde 14:05",
  );
  assert.equal(horaDaParada(new Date("2026-10-26T17:05:00Z"), agora), "26/10 14:05");
  assert.match(tituloParadaNexa("voz", "autenticacao", desde, agora), /^Áudio da Alice parado/);
  assert.equal(
    corpoParadaNexa("ia", 2, 5),
    "5 conversas foram para a equipe (2 empresas). Confira o saldo e a chave da conta da IA.",
  );
  assert.match(notaParadaConversa("credito"), /pausada.*equipe/);
  assert.equal(duracaoDaParada(desde, agora), "55 min");
  assert.equal(duracaoDaParada(new Date("2026-10-27T15:45:00Z"), agora), "2 h 15 min");
});

test("saldo da ElevenLabs: aviso em 30% e em 10%, uma vez cada", async () => {
  const { nivelDeSaldo } = await import("./parada-ia.server");
  assert.equal(nivelDeSaldo(0.5, []), null);
  assert.equal(nivelDeSaldo(0.3, []), 30);
  assert.equal(nivelDeSaldo(0.25, ["ciclo", "30"]), null);
  assert.equal(nivelDeSaldo(0.1, ["ciclo", "30"]), 10);
  assert.equal(nivelDeSaldo(0.05, []), 10);
  assert.equal(nivelDeSaldo(0.05, ["10"]), null);
});
