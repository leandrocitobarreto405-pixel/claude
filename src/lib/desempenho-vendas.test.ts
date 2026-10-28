import { test } from "node:test";
import assert from "node:assert/strict";
import {
  desempenhoPorPessoa,
  mediana,
  primeirasRespostas,
  respostasPeloNexaPorSemana,
  segundaDaSemanaSP,
} from "./desempenho-vendas";

test("mediana", () => {
  assert.equal(mediana([]), null);
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([1, 2, 3, 10]), 2.5);
});

test("1ª resposta: da 1ª mensagem do cliente até a 1ª resposta depois dela", () => {
  const r = primeirasRespostas([
    { conversa: "a", recebida: false, autor: "Equipe", quando: "2026-10-28T09:00:00Z" },
    { conversa: "a", recebida: true, autor: null, quando: "2026-10-28T10:00:00Z" },
    { conversa: "a", recebida: false, autor: "Alice (IA)", quando: "2026-10-28T10:01:00Z" },
    { conversa: "b", recebida: true, autor: null, quando: "2026-10-28T10:00:00Z" },
    { conversa: "c", recebida: true, autor: null, quando: "2026-10-28T11:00:00Z" },
    { conversa: "c", recebida: false, autor: "Maria", quando: "2026-10-28T11:30:00Z" },
  ]);
  assert.deepEqual(r, [
    { autor: "Alice (IA)", minutos: 1 },
    { autor: "Maria", minutos: 30 },
  ]);
});

test("taxa de fechamento pelo autor do orçamento", () => {
  const d = desempenhoPorPessoa(
    [
      { autor: "Maria", virouOs: true },
      { autor: "Maria", virouOs: false },
      { autor: "Maria", virouOs: false },
      { autor: "Alice (IA)", virouOs: true },
    ],
    [{ autor: "Alice (IA)", minutos: 2 }],
  );
  assert.equal(d[0]!.vendedora, "Maria");
  assert.equal(Math.round(d[0]!.taxa!), 33);
  assert.equal(d[0]!.primeiraRespostaMin, null);
  assert.deepEqual({ taxa: d[1]!.taxa, min: d[1]!.primeiraRespostaMin }, { taxa: 100, min: 2 });
});

test("respostas pelo Nexa por semana (segunda a domingo, SP)", () => {
  assert.equal(segundaDaSemanaSP("2026-10-28T14:00:00Z"), "2026-10-26");
  // Domingo 23h em SP (segunda 02h UTC) ainda é a semana anterior.
  assert.equal(segundaDaSemanaSP("2026-10-26T02:00:00Z"), "2026-10-19");
  const r = respostasPeloNexaPorSemana(
    [
      { quando: "2026-10-27T13:00:00Z", peloNexa: true },
      { quando: "2026-10-27T14:00:00Z", peloNexa: false },
      { quando: "2026-10-28T14:00:00Z", peloNexa: false },
      { quando: "2026-10-20T14:00:00Z", peloNexa: false },
      { quando: "2026-01-01T14:00:00Z", peloNexa: true },
    ],
    new Date("2026-10-28T15:00:00Z"),
    3,
  );
  assert.deepEqual(r, [
    { semana: "2026-10-12", total: 0, peloNexa: 0, pct: null },
    { semana: "2026-10-19", total: 1, peloNexa: 0, pct: 0 },
    { semana: "2026-10-26", total: 3, peloNexa: 1, pct: 33.3 },
  ]);
});
