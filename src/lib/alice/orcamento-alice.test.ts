// Classe do estofado, acréscimos por item, desconto (campanha OU indicação) e Pix, com a tabela
// da Turbine de 08/10/2026. Inclui os 3 orçamentos simulados da Alice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { precificar, totalizar, type ItemTabela } from "./orcamento-alice";
import {
  acrescimoDoItem,
  precoComAcrescimo,
  REGRAS_DESLIGADAS,
  type RegrasOrcamento,
} from "@/lib/orcamento-regras";

const turbine: RegrasOrcamento = {
  ...REGRAS_DESLIGADAS,
  classe: { ligada: true, aPct: 20 },
  acrescimos: { ligado: true, almofadasPct: 10, encardidoPct: 10 },
};
const item = (nome: string, hig: number, imp: number | null): ItemTabela => ({
  id: nome,
  nome,
  preco_higienizacao: hig,
  preco_impermeabilizacao: imp,
});
const retratil230 = item("Sofá retrátil 2 módulos, de 2,30 a 2,50 m", 310, 620);
const retratil320 = item("Sofá retrátil 3 módulos, até 3,20 m", 359, 718);
const comum3 = item("Sofá comum 3 lugares", 260, 520);
const cadeiraEncosto = item("Cadeira assento + encosto (unidade)", 55, 93);
const poltrona = item("Poltrona", 129.9, 259.8);
const colchao = item("Colchão casal", 249.9, null);

test("acréscimos somam sobre a tabela: A 20 + almofadas 10 + encardido 10 = 40", () => {
  assert.equal(acrescimoDoItem(turbine, { classe: "A" }), 20);
  assert.equal(acrescimoDoItem(turbine, { classe: "B", almofadasSoltas: true }), 10);
  assert.equal(acrescimoDoItem(turbine, { classe: "C", muitoEncardido: true }), 10);
  assert.equal(
    acrescimoDoItem(turbine, { classe: "A", almofadasSoltas: true, muitoEncardido: true }),
    40,
  );
  // Empresa sem as regras (Ecoprime): nada muda.
  assert.equal(
    acrescimoDoItem(REGRAS_DESLIGADAS, {
      classe: "A",
      almofadasSoltas: true,
      muitoEncardido: true,
    }),
    0,
  );
});

test("arredondamento: com acréscimo vai para o real de cima; sem acréscimo fica a tabela", () => {
  assert.equal(precoComAcrescimo(718, 10), 790); // 789,80 → 790
  assert.equal(precoComAcrescimo(260, 10), 286); // 286,00 continua
  assert.equal(precoComAcrescimo(129.9, 40), 182); // 181,86 → 182
  assert.equal(precoComAcrescimo(129.9, 0), 129.9);
  assert.equal(precoComAcrescimo(280, 20), 336);
});

test("classe e acréscimos valem na higienização e na impermeabilização", () => {
  const p = { item: poltrona, quantidade: 1, classe: "A" as const, almofadas_soltas: true };
  assert.equal(precificar(p, "higienizacao", turbine)?.preco, 169); // 129,90 × 1,30 = 168,87
  assert.equal(precificar(p, "impermeabilizacao", turbine)?.preco, 338); // 259,80 × 1,3 = 337,74
  assert.equal(precificar({ item: colchao, quantidade: 1 }, "impermeabilizacao", turbine), null);
});

test("desconto de campanha OU indicação sobre o total com acréscimos; Pix por cima", () => {
  const linhas = [
    precificar({ item: comum3, quantidade: 1, muito_encardido: true }, "higienizacao", turbine)!,
  ];
  const camp = totalizar(linhas, { pct: 15, rotulo: "Condição da campanha" }, 5, 5);
  assert.equal(camp.bruto, 286);
  assert.equal(camp.desconto?.valor, 42.9);
  assert.equal(camp.cond.total, 243.1);
  assert.equal(camp.cond.pix, 230.95);
  assert.equal(camp.cond.parcela, 48.62);
  const ind = totalizar(linhas, { pct: 10, rotulo: "Desconto de indicação" }, 5, 5);
  assert.equal(ind.cond.total, 257.4);
  assert.equal(ind.cond.pix, 244.53);
});

test("simulação 1: retrátil 2,40 m, almofadas fixas, classe B, higienização", () => {
  const l = precificar({ item: retratil230, quantidade: 1, classe: "B" }, "higienizacao", turbine)!;
  const t = totalizar([l], null, 5, 5);
  assert.deepEqual([l.preco, t.cond.total, t.cond.pix, t.cond.parcela], [310, 310, 294.5, 62]);
});

test("simulação 2: retrátil 3 m, almofadas soltas, impermeabilização", () => {
  const l = precificar(
    { item: retratil320, quantidade: 1, almofadas_soltas: true },
    "impermeabilizacao",
    turbine,
  )!;
  const t = totalizar([l], null, 5, 5);
  assert.deepEqual([l.preco, t.cond.total, t.cond.pix, t.cond.parcela], [790, 790, 750.5, 158]);
  assert.deepEqual(l.rotulos, ["almofadas soltas +10%"]);
});

test("simulação 3: comum 3 lugares muito encardido + 4 cadeiras assento+encosto", () => {
  const sofa = precificar(
    { item: comum3, quantidade: 1, muito_encardido: true },
    "higienizacao",
    turbine,
  )!;
  const cadeiras = precificar({ item: cadeiraEncosto, quantidade: 4 }, "higienizacao", turbine)!;
  const t = totalizar([sofa, cadeiras], null, 5, 5);
  assert.deepEqual([sofa.preco, cadeiras.preco], [286, 55]);
  assert.deepEqual([t.cond.total, t.cond.pix, t.cond.parcela], [506, 480.7, 101.2]);
});
