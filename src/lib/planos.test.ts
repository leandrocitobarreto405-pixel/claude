import { test } from "node:test";
import assert from "node:assert/strict";
import { avisosFimGratis, lerPlano, mensalidade, periodoGratis, type Assinatura } from "./planos";

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

test("aviso do fim do grátis: 15 dias antes, só sem mensalidade", () => {
  const planos = [
    { id: "gestao", preco_mensal: null },
    { id: "basico", preco_mensal: 50 },
  ];
  const assinatura = (extra: Partial<Assinatura>): Assinatura => ({
    id: "a",
    empresa_id: "e",
    plano_id: "gestao",
    valor_mensal: null,
    status: "trial",
    vigencia_inicio: "2026-10-03",
    vigencia_fim: null,
    gratis_ate: "2027-01-02",
    proximo_vencimento: "2027-01-03",
    contrato_pdf_path: null,
    contrato_pdf_em: null,
    ...extra,
  });
  const eco = [{ nome: "Ecoprime", assinatura: assinatura({}) }];
  assert.deepEqual(avisosFimGratis(eco, planos, "2026-12-17"), []);
  assert.deepEqual(avisosFimGratis(eco, planos, "2026-12-18"), [
    "Ecoprime: período grátis termina em 02/01 — defina a mensalidade",
  ]);
  assert.deepEqual(avisosFimGratis(eco, planos, "2027-01-05"), [
    "Ecoprime: período grátis terminou em 02/01 — defina a mensalidade",
  ]);
  // R$ 0 também avisa; com valor definido (na assinatura ou no plano) não.
  const zero = [{ nome: "Z", assinatura: assinatura({ valor_mensal: 0 }) }];
  assert.equal(avisosFimGratis(zero, planos, "2026-12-20").length, 1);
  const definida = [{ nome: "D", assinatura: assinatura({ valor_mensal: 297 }) }];
  assert.deepEqual(avisosFimGratis(definida, planos, "2026-12-20"), []);
  const basico = [{ nome: "B", assinatura: assinatura({ plano_id: "basico" }) }];
  assert.deepEqual(avisosFimGratis(basico, planos, "2026-12-20"), []);
  // Sem grátis (Turbine, interna R$ 0), cancelada ou sem assinatura: nada.
  const outras = [
    { nome: "Turbine", assinatura: assinatura({ gratis_ate: null, valor_mensal: 0 }) },
    { nome: "C", assinatura: assinatura({ status: "cancelada" }) },
    { nome: "S", assinatura: null },
  ];
  assert.deepEqual(avisosFimGratis(outras, planos, "2026-12-20"), []);
});
