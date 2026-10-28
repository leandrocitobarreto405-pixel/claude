import { test } from "node:test";
import assert from "node:assert/strict";
import { desempenhoPorPessoa, mediana, primeirasRespostas } from "./desempenho-vendas";

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
