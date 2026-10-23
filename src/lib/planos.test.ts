import { test } from "node:test";
import assert from "node:assert/strict";
import { lerPlano, mensalidade, periodoGratis } from "./planos";

test("3 meses grátis desde o início do contrato", () => {
  assert.deepEqual(periodoGratis("2026-10-03", 3), {
    gratisAte: "2027-01-02",
    vencimento: "2027-01-03",
  });
  // 30/11 + 3 meses: fevereiro não tem 30 → vence no último dia de fevereiro.
  assert.deepEqual(periodoGratis("2026-11-30", 3), {
    gratisAte: "2027-02-27",
    vencimento: "2027-02-28",
  });
});

test("mensalidade: a da assinatura, senão a do plano (null = a definir)", () => {
  assert.equal(mensalidade({ valor_mensal: 250 }, { preco_mensal: 297 }), 250);
  assert.equal(mensalidade({ valor_mensal: null }, { preco_mensal: 297 }), 297);
  assert.equal(mensalidade({ valor_mensal: null }, { preco_mensal: null }), null);
  assert.equal(mensalidade({ valor_mensal: 0 }, { preco_mensal: null }), 0);
});

test("plano lido do banco: números e recursos", () => {
  const p = lerPlano({
    id: "p",
    codigo: "basico",
    nome: "Básico",
    preco_mensal: "50.00",
    comissao_pct: "0.000",
    recursos: { alice: false, caixa_entrada: false, marketing: "x" },
  });
  assert.equal(p.preco_mensal, 50);
  assert.equal(p.comissao_pct, 0);
  assert.deepEqual(p.recursos, { alice: false, caixa_entrada: false, marketing: false });
  assert.equal(p.ativo, true);
});
