import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avisosFimGratis,
  fimDoTeste,
  lerPlano,
  mensalidade,
  mrr,
  periodoGratis,
  situacaoCobranca,
  type Assinatura,
} from "./planos";

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
  // R$ 0 também avisa; com valor definido (na assinatura ou no plano) avisa quanto passa a pagar,
  // só até o fim do grátis.
  const zero = [{ nome: "Z", assinatura: assinatura({ valor_mensal: 0 }) }];
  assert.equal(avisosFimGratis(zero, planos, "2026-12-20").length, 1);
  const definida = [{ nome: "D", assinatura: assinatura({ valor_mensal: 297 }) }];
  assert.deepEqual(avisosFimGratis(definida, planos, "2026-12-17"), []);
  assert.deepEqual(avisosFimGratis(definida, planos, "2026-12-20"), [
    "D: período grátis termina em 02/01 — passa a pagar R$\u00a0297,00 em 03/01/2027",
  ]);
  assert.deepEqual(avisosFimGratis(definida, planos, "2027-01-03"), []);
  const basico = [{ nome: "B", assinatura: assinatura({ plano_id: "basico" }) }];
  assert.equal(avisosFimGratis(basico, planos, "2026-12-20").length, 1);
  // Sem grátis (Turbine, interna R$ 0), cancelada ou sem assinatura: nada.
  const outras = [
    { nome: "Turbine", assinatura: assinatura({ gratis_ate: null, valor_mensal: 0 }) },
    { nome: "C", assinatura: assinatura({ status: "cancelada" }) },
    { nome: "S", assinatura: null },
  ];
  assert.deepEqual(avisosFimGratis(outras, planos, "2026-12-20"), []);
});

test("MRR: só ativas e inadimplentes com mensalidade", () => {
  const planos = [
    { id: "basico", preco_mensal: 50 },
    { id: "gestao", preco_mensal: null },
  ];
  const a = (plano_id: string, status: Assinatura["status"], valor_mensal: number | null = null) =>
    ({ plano_id, status, valor_mensal }) as Assinatura;
  assert.equal(
    mrr(
      [
        a("basico", "ativa"),
        a("basico", "inadimplente", 297),
        a("gestao", "trial"),
        a("gestao", "ativa"),
        a("basico", "cancelada"),
        a("basico", "trial"),
        null,
      ],
      planos,
    ),
    347,
  );
});

test("cobrança: situação na lista do Painel Nexa", () => {
  const hoje = "2026-10-26";
  const a = (extra: Partial<Assinatura>) =>
    ({ status: "ativa", gratis_ate: null, isenta: false, ...extra }) as Assinatura;
  assert.equal(situacaoCobranca(a({ isenta: true }), "ok", hoje).rotulo, "Isenta");
  assert.equal(
    situacaoCobranca(a({ status: "trial", gratis_ate: "2026-11-25" }), "ok", hoje).rotulo,
    "Em teste até 25/11/2026",
  );
  assert.equal(
    situacaoCobranca(a({ status: "trial", gratis_ate: "2026-10-01" }), "ok", hoje).rotulo,
    "Ativa",
  );
  assert.equal(situacaoCobranca(a({ status: "inadimplente" }), "aviso", hoje).rotulo, "Carência");
  assert.equal(
    situacaoCobranca(a({ status: "inadimplente" }), "somente_leitura", hoje).rotulo,
    "Somente consulta",
  );
  assert.equal(situacaoCobranca(a({ isenta: true }), "bloqueada", hoje).rotulo, "Bloqueada");
  assert.equal(situacaoCobranca(null, "ok", hoje).rotulo, "Ativa");
});

test("cobrança: atalhos do teste e isenta fora do MRR e dos avisos", () => {
  assert.equal(fimDoTeste("2026-10-26", "30d"), "2026-11-25");
  assert.equal(fimDoTeste("2026-10-26", "3m"), "2027-01-25");
  const planos = [{ id: "p", preco_mensal: 247 }];
  const base = {
    id: "a",
    empresa_id: "e",
    plano_id: "p",
    valor_mensal: null,
    status: "ativa" as const,
    vigencia_inicio: "2026-10-01",
    vigencia_fim: null,
    gratis_ate: null,
    proximo_vencimento: null,
    contrato_pdf_path: null,
    contrato_pdf_em: null,
  };
  assert.equal(mrr([base, { ...base, isenta: true }], planos), 247);
  assert.deepEqual(
    avisosFimGratis(
      [{ nome: "T", assinatura: { ...base, isenta: true, gratis_ate: "2026-10-30" } }],
      planos,
      "2026-10-26",
    ),
    [],
  );
});
