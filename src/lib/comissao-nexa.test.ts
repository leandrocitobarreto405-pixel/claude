import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pctNaData,
  repasseAtendentes,
  resumoNexaDaEmpresa,
  textoPercentuais,
} from "./comissao-nexa";

const a = (
  salesperson: string,
  received: number,
  commissionPct: number,
  nexa = true,
  ia = false,
) => ({
  salesperson,
  salespersonNexa: nexa,
  salespersonIa: ia,
  received,
  commissionPct,
});

test("comissão da Nexa na empresa: só vendas das atendentes da Nexa, como no DRE", () => {
  const r = resumoNexaDaEmpresa([
    a("Carol", 1000, 5),
    a("Maria", 500, 5),
    a("Carol", 200, 5),
    a("Joana", 800, 3, false),
    a("Alice (IA)", 300, 0, true, true),
    a("Maria", 0, 5),
  ]);
  assert.equal(r.recebido, 2000);
  assert.equal(r.comissao, 85);
  assert.deepEqual(r.percentuais, [5]);
  assert.deepEqual(r.porVendedora["Carol"], { recebido: 1200, comissao: 60, ia: false });
  assert.equal(r.porVendedora["Joana"], undefined);
  assert.equal(r.porVendedora["Alice (IA)"]?.ia, true);
  assert.equal(textoPercentuais(r.percentuais), "5%");
  assert.equal(textoPercentuais([3, 5]), "3% e 5%");
  assert.equal(textoPercentuais([2.5]), "2,5%");
});

test("repasse às atendentes: soma as empresas pelo nome e deixa a IA de fora", () => {
  const turbine = resumoNexaDaEmpresa([
    a("Carol", 1000, 3),
    a("Maria", 2000, 3),
    a("Alice (IA)", 500, 0, true, true),
  ]);
  const eco = resumoNexaDaEmpresa([a("carol ", 400, 5)]);
  const r = repasseAtendentes(
    [
      { nome: "Turbine Clean", resumo: turbine },
      { nome: "Ecoprime", resumo: eco },
    ],
    3,
  );
  assert.deepEqual(
    r.map((x) => [x.nome, x.recebido, x.repasse]),
    [
      ["Maria", 2000, 60],
      ["Carol", 1400, 42],
    ],
  );
  assert.deepEqual(r[1]!.porEmpresa, [
    { empresa: "Turbine Clean", recebido: 1000 },
    { empresa: "Ecoprime", recebido: 400 },
  ]);
});

test("% da Nexa: o do contrato vigente na data da venda", () => {
  const contratos = [
    { empresa_id: "e", percentual: 5, vigencia_inicio: "2026-10-03", vigencia_fim: "2026-11-30" },
    { empresa_id: "e", percentual: 7, vigencia_inicio: "2026-12-01", vigencia_fim: null },
    { empresa_id: "f", percentual: 3, vigencia_inicio: "2026-01-01", vigencia_fim: null },
  ];
  assert.equal(pctNaData(contratos, "e", "2026-11-30"), 5);
  // Pagamento depois da mudança: vale a data da venda.
  assert.equal(pctNaData(contratos, "e", "2026-11-20T10:00:00"), 5);
  assert.equal(pctNaData(contratos, "e", "2026-12-01"), 7);
  assert.equal(pctNaData(contratos, "e", "2026-10-01"), null);
  assert.equal(pctNaData(contratos, "f", "2026-10-01"), 3);
  assert.equal(pctNaData(contratos, "e", null), null);
});
