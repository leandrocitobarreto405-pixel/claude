import { test } from "node:test";
import assert from "node:assert/strict";
import { mesVizinho, mesesAte, porCategoria, porMes, proximos30 } from "./financeiro";

test("6 meses até o escolhido, do mais antigo para o mais recente", () => {
  const m = mesesAte("2026-10", 6);
  assert.deepEqual(
    m.map((x) => x.rotulo),
    ["mai", "jun", "jul", "ago", "set", "out"],
  );
  assert.deepEqual(m[0], { mes: "2026-05", rotulo: "mai", de: "2026-05-01", ate: "2026-05-31" });
  assert.equal(mesesAte("2026-01", 3)[0]!.mes, "2025-11");
});

test("entrou e saiu por mês pela data", () => {
  const meses = mesesAte("2026-10", 2);
  const r = porMes(
    meses,
    [
      { data: "2026-09-10", valor: 100 },
      { data: "2026-10-01", valor: 50.5 },
      { data: null, valor: 999 },
    ],
    [
      { data: "2026-10-31", valor: 20 },
      { data: "2026-08-01", valor: 7 },
    ],
  );
  assert.deepEqual(r, [
    { mes: "2026-09", rotulo: "set", recebido: 100, pago: 0 },
    { mes: "2026-10", rotulo: "out", recebido: 50.5, pago: 20 },
  ]);
});

test("despesas por categoria, da maior para a menor", () => {
  assert.deepEqual(
    porCategoria([
      { categoria: "Insumos", valor: 100 },
      { categoria: "Fixas", valor: 300 },
      { categoria: "Insumos", valor: 50 },
      { categoria: "", valor: 1 },
      { categoria: "Zero", valor: 0 },
    ]),
    [
      { categoria: "Fixas", valor: 300 },
      { categoria: "Insumos", valor: 150 },
      { categoria: "Outros", valor: 1 },
    ],
  );
});

test("próximos 30 dias: a receber e a pagar", () => {
  const r = proximos30(
    "2026-10-14",
    [
      { kind: "concluido", scheduledDate: "2026-09-01", balance: 300 },
      { kind: "agendado", scheduledDate: "2026-10-20", balance: 200 },
      { kind: "agendado", scheduledDate: "2026-12-01", balance: 999 },
    ],
    [
      { due_date: "2026-10-10", restante: 50, status: "Pendente" }, // vencida
      { due_date: "2026-11-05", restante: 80, status: "Pendente" },
      { due_date: "2026-12-30", restante: 1000, status: "Pendente" },
      { due_date: "2026-10-20", restante: 0, status: "Pago" },
      { due_date: null, restante: 10, status: "Pendente" },
    ],
  );
  assert.deepEqual(r, { aReceber: 500, aPagar: 140, aReceberConcluidos: 300, aPagarVencidas: 50 });
});

test("mesVizinho vira o ano nos dois sentidos", () => {
  assert.equal(mesVizinho("2026-01", -1), "2025-12");
  assert.equal(mesVizinho("2026-12", 1), "2027-01");
  assert.equal(mesVizinho("2026-10", 1), "2026-11");
});
