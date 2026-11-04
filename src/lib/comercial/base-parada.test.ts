import { test } from "node:test";
import assert from "node:assert/strict";
import { amostraProporcional, exemplosValidos, grupoDaBase } from "./base-parada";

test("base parada: grupo pelo que aconteceu", () => {
  const b = { entrada: "ativo", respondeu: false, recebeuDisparo: true, teveOrcamento: false };
  assert.equal(grupoDaBase(b), "so_campanha");
  assert.equal(grupoDaBase({ ...b, recebeuDisparo: false }), "equipe_sem_resposta");
  assert.equal(grupoDaBase({ ...b, respondeu: true }), "respondeu_campanha");
  assert.equal(grupoDaBase({ ...b, respondeu: true, recebeuDisparo: false }), "retomado_parou");
  assert.equal(grupoDaBase({ ...b, respondeu: true, teveOrcamento: true }), "orcamento_antigo");
  assert.equal(grupoDaBase({ ...b, entrada: "receptivo", respondeu: true }), "chegou_sozinho");
  assert.equal(
    grupoDaBase({ ...b, entrada: "receptivo", respondeu: true, teveOrcamento: true }),
    "orcamento_antigo",
  );
});

test("base parada: amostra com mínimo por grupo e o resto proporcional", () => {
  const a = amostraProporcional({
    so_campanha: 345,
    respondeu_campanha: 32,
    chegou_sozinho: 33,
    equipe_sem_resposta: 38,
    retomado_parou: 22,
  });
  const soma = Object.values(a).reduce((s, n) => s + n, 0);
  assert.equal(soma, 50);
  assert.ok(a.respondeu_campanha >= 6 && a.retomado_parou >= 6);
  assert.ok(a.so_campanha > a.chegou_sozinho);
  assert.equal(a.orcamento_antigo, 0);
});

test("base parada: grupo pequeno entra inteiro e a soma não passa do total", () => {
  const a = amostraProporcional({ chegou_sozinho: 1, retomado_parou: 1 });
  assert.equal(a.chegou_sozinho, 1);
  assert.equal(a.retomado_parou, 1);
  const b = amostraProporcional({ so_campanha: 10, chegou_sozinho: 100 }, 20);
  assert.equal(
    Object.values(b).reduce((s, n) => s + n, 0),
    20,
  );
  assert.ok(b.so_campanha <= 10);
});

test("base parada: exemplos só com finais da amostra", () => {
  const amostra = new Set(["1234", "5678", "0001"]);
  assert.deepEqual(exemplosValidos(["…1234", "final 5678", "9999", "1234"], amostra), [
    "1234",
    "5678",
  ]);
});
