import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avisoDaDeteccao,
  codigoDaOrigem,
  erroDaOrigem,
  lerDeteccao,
  resumoDeteccao,
} from "./origem-venda";

test("lê a resposta do banco", () => {
  assert.deepEqual(lerDeteccao({ origem_id: "o1", como: "landing" }), {
    origemId: "o1",
    como: "landing",
  });
  assert.equal(lerDeteccao({}), null);
  assert.equal(lerDeteccao(null), null);
  assert.equal(lerDeteccao({ origem_id: "o1", como: "chute" }), null);
});

test("aviso embaixo do campo", () => {
  assert.equal(avisoDaDeteccao("primeira_mensagem"), "detectada pela primeira mensagem");
  assert.equal(avisoDaDeteccao("landing"), "detectada pela landing (pop-up do anúncio)");
  assert.equal(avisoDaDeteccao("cliente_antigo"), "detectada: cliente com serviço anterior");
  assert.equal(avisoDaDeteccao(null), null);
});

test("origem obrigatória e indicação com o nome de quem indicou", () => {
  const base = { origemId: "o1", origemCodigo: "google", indicacaoNome: "" };
  assert.equal(erroDaOrigem(base), null);
  assert.equal(erroDaOrigem({ ...base, origemId: "" }), "Selecione a origem da venda.");
  assert.equal(erroDaOrigem({ ...base, origemCodigo: "indicacao" }), "Informe quem indicou.");
  assert.equal(erroDaOrigem({ ...base, origemCodigo: "indicacao", indicacaoNome: "Rita" }), null);
});

test("código da origem pelo metadata", () => {
  const opcoes = [
    { id: "a", metadata: { codigo: "indicacao" } },
    { id: "b", metadata: null },
  ];
  assert.equal(codigoDaOrigem(opcoes, "a"), "indicacao");
  assert.equal(codigoDaOrigem(opcoes, "b"), "");
  assert.equal(codigoDaOrigem(opcoes, "x"), "");
});

test("resumo da detecção: iguais, trocadas, Alice à parte e sem detecção", () => {
  const l = (
    id: string,
    escolhida: string | null,
    detectada: string | null,
    como: string | null,
  ) => ({
    id,
    osNumber: id,
    criadaEm: "2026-10-23T12:00:00Z",
    escolhidaId: escolhida,
    detectadaId: detectada,
    como,
    trocadaPor: null,
  });
  const r = resumoDeteccao([
    l("1", "g", "g", "landing"),
    l("2", "g", "i", "canal"),
    l("3", "a", "a", "alice"),
    l("4", "g", null, null),
  ]);
  assert.equal(r.detectadas, 2);
  assert.equal(r.iguais, 1);
  assert.deepEqual(
    r.trocadas.map((t) => t.id),
    ["2"],
  );
  assert.equal(r.pctIguais, 50);
  assert.equal(r.daAlice, 1);
  assert.equal(r.semDeteccao, 1);
});
