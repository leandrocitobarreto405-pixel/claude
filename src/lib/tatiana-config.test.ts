// Projeção do gasto da Tatiana no mês (Configurações › Vendas › Tatiana).
import { test } from "node:test";
import assert from "node:assert/strict";
import { projecaoDoMes } from "./tatiana-config";

test("projeção: já gasto + média das últimas 7 noites × noites que faltam", () => {
  // 10/11: faltam 21 noites (10 a 30); média 4,00.
  assert.equal(projecaoDoMes([4, 4, 4, 4, 4, 4, 4, 9], 30, "2026-11-10"), 114);
  // Último dia: falta a noite de hoje.
  assert.equal(projecaoDoMes([2], 50, "2026-11-30"), 52);
});

test("projeção sem noites no mês: só o já gasto", () => {
  assert.equal(projecaoDoMes([], 0, "2026-11-01"), 0);
});
