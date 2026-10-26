// Consumo das empresas: leitura da linha do banco e totais sem as empresas de teste.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerConsumo, mensagensAutomaticas, totaisDoConsumo } from "./consumo";

const a = lerConsumo({
  empresa_id: "a",
  nome: "Empresa A",
  eh_teste: false,
  ia_respostas: "10",
  ia_mensagens: "14",
  ia_custo_usd: "1.2345",
  audios: "2",
  audio_custo_reais: "0.40",
  mkt_mensagens: "5",
  pos_atendimento_mensagens: "3",
  agenda_mensagens: "4",
});
const teste = lerConsumo({
  empresa_id: "t",
  nome: "Teste",
  eh_teste: true,
  ia_respostas: 99,
  ia_custo_usd: 9,
});

test("lê números do banco e soma as mensagens automáticas", () => {
  assert.equal(a.ia_custo_usd, 1.2345);
  assert.equal(mensagensAutomaticas(a), 12);
  assert.equal(teste.agenda_mensagens, 0);
});

test("totais sem as empresas de teste", () => {
  assert.deepEqual(totaisDoConsumo([a, teste]), {
    iaRespostas: 10,
    iaCustoUsd: 1.23,
    audioCustoReais: 0.4,
    automaticas: 12,
  });
});
