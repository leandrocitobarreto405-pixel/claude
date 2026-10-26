// Cupons na Alice: valor em reais do serviço do cupom, Pix por cima, cupom do outro serviço,
// um desconto só (o maior) e cupom citado na primeira mensagem. Tabela da Turbine (sofá comum).
import { test } from "node:test";
import assert from "node:assert/strict";
import { precificar, totalizar, type ItemTabela } from "./orcamento-alice";
import {
  conferirCupom,
  cupomNoPrazo,
  cupomNoTexto,
  maiorDesconto,
  rotuloCupom,
  valorDoCupom,
  type Cupom,
} from "./cupons";
import { REGRAS_DESLIGADAS, type RegrasOrcamento } from "@/lib/orcamento-regras";

const turbine: RegrasOrcamento = {
  ...REGRAS_DESLIGADAS,
  classe: { ligada: true, aPct: 20 },
  acrescimos: { ligado: true, almofadasPct: 10, encardidoPct: 10 },
};
const comum3: ItemTabela = {
  id: "sofa3",
  nome: "Sofá comum 3 lugares",
  preco_higienizacao: 260,
  preco_impermeabilizacao: 520,
};
const CUPONS: Cupom[] = [
  { codigo: "BLOG50", valor: 50, servico: "higienizacao", canal: "BLOG" },
  { codigo: "SITE50", valor: 50, servico: "higienizacao", canal: "SITE" },
  { codigo: "BLOG82", valor: 82, servico: "impermeabilizacao", canal: "BLOG" },
  { codigo: "SITE82", valor: 82, servico: "impermeabilizacao", canal: "SITE" },
];

function orcamento(codigo: string, servico: "higienizacao" | "impermeabilizacao") {
  const c = conferirCupom(codigo, servico, CUPONS);
  assert.ok(c.ok, `cupom ${codigo} aceito`);
  const linha = precificar({ item: comum3, quantidade: 1 }, servico, turbine)!;
  return totalizar(
    [linha],
    {
      valor: valorDoCupom(c.cupom, linha.preco * linha.quantidade),
      rotulo: `Cupom ${c.cupom.codigo}`,
    },
    5,
    5,
  );
}

for (const codigo of ["BLOG50", "SITE50"]) {
  test(`${codigo}: higienização do sofá 3 lugares 260 − 50 = 210; Pix 199,50; 5x 42`, () => {
    const t = orcamento(codigo, "higienizacao");
    assert.equal(t.bruto, 260);
    assert.deepEqual(t.desconto, { pct: null, rotulo: `Cupom ${codigo}`, valor: 50 });
    assert.equal(t.cond.total, 210);
    assert.equal(t.cond.pix, 199.5);
    assert.equal(t.cond.parcelas, 5);
    assert.equal(t.cond.parcela, 42);
  });
}

for (const codigo of ["BLOG82", "SITE82"]) {
  test(`${codigo}: impermeabilização do sofá 3 lugares 520 − 82 = 438; Pix 416,10; 5x 87,60`, () => {
    const t = orcamento(codigo, "impermeabilizacao");
    assert.equal(t.bruto, 520);
    assert.equal(t.desconto?.valor, 82);
    assert.equal(t.cond.total, 438);
    assert.equal(t.cond.pix, 416.1);
    assert.equal(t.cond.parcela, 87.6);
  });
}

test("cupom do outro serviço: explica e oferece o do mesmo canal", () => {
  const a = conferirCupom("blog50", "impermeabilizacao", CUPONS);
  assert.equal(a.ok, false);
  assert.ok(!a.ok && a.alternativa?.codigo === "BLOG82");
  assert.match(!a.ok ? a.texto : "", /BLOG50 vale só para higienização.*BLOG82/);
  const b = conferirCupom("SITE82", "higienizacao", CUPONS);
  assert.ok(!b.ok && b.alternativa?.codigo === "SITE50");
  const c = conferirCupom("XYZ10", "higienizacao", CUPONS);
  assert.ok(!c.ok && c.alternativa === null);
  assert.match(!c.ok ? c.texto : "", /não existe/);
});

test("cupom nunca deixa o total negativo", () => {
  const barato: ItemTabela = {
    id: "p",
    nome: "Puff",
    preco_higienizacao: 40,
    preco_impermeabilizacao: 80,
  };
  const l = precificar({ item: barato, quantidade: 1 }, "higienizacao", turbine)!;
  const t = totalizar([l], { valor: 50, rotulo: "Cupom BLOG50" }, 5, 5);
  assert.equal(t.desconto?.valor, 40);
  assert.equal(t.cond.total, 0);
});

test("um desconto por orçamento: vale o maior entre cupom e campanha/indicação", () => {
  const blog50 = CUPONS[0]!;
  // 15% de 260 = 39 < 50: cupom.
  assert.deepEqual(maiorDesconto(260, blog50, { pct: 15, rotulo: "Campanha" }), {
    tipo: "cupom",
    cupom: blog50,
  });
  // 20% de 600 = 120 > 50: campanha.
  assert.equal(maiorDesconto(600, blog50, { pct: 20, rotulo: "Campanha" })?.tipo, "pct");
  assert.equal(maiorDesconto(260, null, null), null);
});

test("cupom citado na primeira mensagem é reconhecido (sem pedir de novo)", () => {
  assert.equal(
    cupomNoTexto(
      "Olá! Vi o cupom BLOG50 no blog e quero higienizar meu estofado com R$50 de desconto.",
      CUPONS,
    )?.codigo,
    "BLOG50",
  );
  assert.equal(cupomNoTexto("(cupom site82).", CUPONS)?.codigo, "SITE82");
  assert.equal(cupomNoTexto("quero um orçamento", CUPONS), null);
  assert.equal(cupomNoTexto("BLOG500", CUPONS), null);
});

test("cupom em percentual, rótulo e validade (tela de cupons)", () => {
  const pct: Cupom = {
    codigo: "DEZ10",
    valor: null,
    percentual: 10,
    servico: "higienizacao",
    canal: null,
  };
  assert.equal(valorDoCupom(pct, 260), 26);
  assert.equal(valorDoCupom({ valor: 300 }, 260), 260, "nunca maior que a base");
  assert.equal(rotuloCupom(pct), "10%");
  assert.equal(rotuloCupom({ valor: 50 }), "R$ 50,00");
  assert.equal(maiorDesconto(260, pct, { pct: 5, rotulo: "Pix" })?.tipo, "cupom");
  assert.equal(maiorDesconto(260, pct, { pct: 15, rotulo: "Indicação" })?.tipo, "pct");
  assert.equal(cupomNoPrazo(null, "2026-10-26"), true);
  assert.equal(cupomNoPrazo("2026-10-26", "2026-10-26"), true, "o último dia vale");
  assert.equal(cupomNoPrazo("2026-10-25", "2026-10-26"), false);
});
