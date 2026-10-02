import { test } from "node:test";
import assert from "node:assert/strict";
import { dataPorExtenso, horaEmSaoPaulo, percentualDaMeta, primeiroNome, saudacao } from "./inicio";

test("saudacao pela hora", () => {
  assert.equal(saudacao(5), "Bom dia");
  assert.equal(saudacao(11), "Bom dia");
  assert.equal(saudacao(12), "Boa tarde");
  assert.equal(saudacao(17), "Boa tarde");
  assert.equal(saudacao(18), "Boa noite");
  assert.equal(saudacao(2), "Boa noite");
});

test("hora em São Paulo (UTC-3)", () => {
  assert.equal(horaEmSaoPaulo(new Date("2026-10-02T11:43:00Z")), 8);
  assert.equal(horaEmSaoPaulo(new Date("2026-10-02T02:10:00Z")), 23);
  assert.equal(horaEmSaoPaulo(new Date("2026-10-02T03:00:00Z")), 0);
});

test("primeiroNome", () => {
  assert.equal(primeiroNome("maria souza"), "Maria");
  assert.equal(primeiroNome("  Leandro  Barreto "), "Leandro");
  assert.equal(primeiroNome(""), "");
});

test("dataPorExtenso", () => {
  assert.equal(dataPorExtenso("2026-10-01"), "1 de outubro");
  assert.equal(dataPorExtenso("2026-03-15"), "15 de março");
});

test("percentualDaMeta fica entre 0 e 100 e sem meta é 0", () => {
  assert.equal(percentualDaMeta(5000, 20000), 25);
  assert.equal(percentualDaMeta(30000, 20000), 100);
  assert.equal(percentualDaMeta(100, 0), 0);
  assert.equal(percentualDaMeta(-10, 100), 0);
});
