// Vendido pela data do serviço: rateio do desconto, remarcação, cancelamento, OS de teste e
// Realizado + Agendado + Atrasado. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vendidoNoPeriodo,
  vendidoParaProximosMeses,
  vendidoPorOrigemServico,
  vendidoPorVendedora,
  visitasComValor,
  type OsVendido,
  type VisitaVendido,
} from "./vendido";

const HOJE = "2026-10-20";
const OUT = { de: "2026-10-01", ate: "2026-10-31" };
const NOV = { de: "2026-11-01", ate: "2026-11-30" };

function visita(id: string, data: string, valor: number, extra: Partial<VisitaVendido> = {}) {
  return {
    id,
    status: "Agendado",
    scheduled_date: data,
    completion_date: null,
    visit_value: valor,
    final_value: null,
    repasse_parceiro: 0,
    discount_amount: 0,
    ...extra,
  } satisfies VisitaVendido;
}

function os(total: number, visitas: VisitaVendido[], extra: Partial<OsVendido> = {}): OsVendido {
  return {
    id: `os-${Math.random().toString(36).slice(2, 8)}`,
    os_number: "0001",
    total_gross_value: total,
    status: "Agendada",
    eh_teste: false,
    deleted_at: null,
    origem: "Google",
    visitas,
    ...extra,
  };
}

test("OS em dois meses com desconto: cada mês leva a sua parte e a soma dá o total", () => {
  // Visitas de R$ 600 (out) e R$ 400 (nov); a OS fechou em R$ 900 (desconto de 10%).
  const o = os(900, [visita("a", "2026-10-25", 600), visita("b", "2026-11-05", 400)]);
  const out = vendidoNoPeriodo([o], OUT, HOJE);
  const nov = vendidoNoPeriodo([o], NOV, HOJE);
  assert.equal(out.valor, 540);
  assert.equal(nov.valor, 360);
  assert.equal(out.valor + nov.valor, 900);
});

test("rateio com centavos: a última visita fica com a sobra e a soma bate", () => {
  const o = os(100, [
    visita("a", "2026-10-21", 33.33),
    visita("b", "2026-10-22", 33.33),
    visita("c", "2026-10-23", 33.34),
  ]);
  const v = visitasComValor(o, HOJE);
  assert.equal(Math.round(v.reduce((s, x) => s + x.valor, 0) * 100), 10000);
});

test("remarcou para outro mês: o valor muda de mês", () => {
  const antes = os(500, [visita("a", "2026-10-28", 500)]);
  const depois = os(500, [visita("a", "2026-11-03", 500, { status: "Reagendado" })]);
  assert.equal(vendidoNoPeriodo([antes], OUT, HOJE).valor, 500);
  assert.equal(vendidoNoPeriodo([depois], OUT, HOJE).valor, 0);
  assert.equal(vendidoNoPeriodo([depois], NOV, HOJE).valor, 500);
});

test("cancelamento: visita cancelada sai (o total vai para as outras); OS cancelada sai", () => {
  const umaCancelada = os(800, [
    visita("a", "2026-10-25", 400),
    visita("b", "2026-10-26", 400, { status: "Cancelado" }),
  ]);
  assert.equal(vendidoNoPeriodo([umaCancelada], OUT, HOJE).valor, 800);
  const osCancelada = os(800, [visita("a", "2026-10-25", 800)], { status: "Cancelada" });
  assert.equal(vendidoNoPeriodo([osCancelada], OUT, HOJE).valor, 0);
  const excluida = os(800, [visita("a", "2026-10-25", 800)], { deleted_at: "2026-10-19" });
  assert.equal(vendidoNoPeriodo([excluida], OUT, HOJE).valor, 0);
});

test("OS de teste fica fora do Vendido", () => {
  const teste = os(6959, [visita("a", "2026-10-16", 6959)], { eh_teste: true });
  const real = os(300, [visita("b", "2026-10-16", 300)]);
  const v = vendidoNoPeriodo([teste, real], OUT, HOJE);
  assert.equal(v.valor, 300);
  assert.equal(v.quantidade, 1);
});

test("Realizado + Agendado + Atrasado = Vendido (data da conclusão para o realizado)", () => {
  const oss = [
    os(200, [
      visita("feita", "2026-10-05", 200, { status: "Concluído", completion_date: "2026-10-06" }),
    ]),
    os(300, [visita("atrasada", "2026-10-10", 300)]),
    os(500, [visita("futura", "2026-10-27", 500, { status: "Confirmado" })]),
    os(100, [visita("hoje", HOJE, 100)]),
  ];
  const v = vendidoNoPeriodo(oss, OUT, HOJE);
  assert.equal(v.realizado, 200);
  assert.equal(v.atrasado, 300);
  assert.equal(v.atrasadoQtd, 1);
  assert.equal(v.agendado, 600, "hoje ainda conta como agendado");
  assert.equal(v.realizado + v.agendado + v.atrasado, v.valor);
  assert.equal(v.valor, 1100);
});

test("concluída em outro mês conta no mês da conclusão", () => {
  const o = os(400, [
    visita("a", "2026-09-29", 400, { status: "Concluído", completion_date: "2026-10-01" }),
  ]);
  assert.equal(vendidoNoPeriodo([o], OUT, HOJE).realizado, 400);
  assert.equal(vendidoNoPeriodo([o], { de: "2026-09-01", ate: "2026-09-30" }, HOJE).valor, 0);
});

test("vendido líquido do repasse, com o cheio ao lado (item terceirizado)", () => {
  const o = os(1000, [visita("a", "2026-10-25", 1000, { repasse_parceiro: 350 })], {
    origem: "Google",
  });
  const v = vendidoNoPeriodo([o], OUT, HOJE);
  assert.equal(v.valor, 650);
  assert.equal(v.cheio, 1000);
  assert.equal(v.agendado, 650);
  assert.deepEqual(vendidoPorOrigemServico(v), [{ origem: "Google", valor: 650, quantidade: 1 }]);
});

test("por origem: valor e OS distintas", () => {
  const oss = [
    os(300, [visita("a", "2026-10-21", 300)], { origem: "Google" }),
    os(200, [visita("b", "2026-10-22", 200)], { origem: null }),
  ];
  assert.deepEqual(vendidoPorOrigemServico(vendidoNoPeriodo(oss, OUT, HOJE)), [
    { origem: "Google", valor: 300, quantidade: 1 },
    { origem: "Sem origem", valor: 200, quantidade: 1 },
  ]);
});

test("quem vendeu: por vendedora, pela data do serviço, e a soma bate com o Vendido do mês", () => {
  const oss = [
    os(300, [visita("a", "2026-10-10", 300)], { vendedora: "Vendedora A" }),
    os(400, [visita("b1", "2026-10-25", 200), visita("b2", "2026-11-05", 200)], {
      vendedora: "Vendedora B",
    }),
    os(150, [visita("c", "2026-10-12", 150)], { vendedora: null }),
  ];
  const v = vendidoNoPeriodo(oss, OUT, HOJE);
  const q = vendidoPorVendedora(v);
  assert.deepEqual(
    q.map((l) => [l.vendedora, l.valor, l.quantidade]),
    [
      ["Vendedora A", 300, 1],
      ["Vendedora B", 200, 1],
      ["Sem vendedora", 150, 1],
    ],
  );
  assert.equal(
    q.reduce((s, l) => s + l.valor, 0),
    v.valor,
  );
});

test("já vendido para os próximos meses: fechado no mês, serviço depois do mês, fora do Vendido", () => {
  const fechadas = [
    // Fechada em outubro: metade em outubro (Vendido) e metade em novembro (projeção).
    os(400, [visita("x1", "2026-10-25", 200), visita("x2", "2026-11-05", 200)], {
      sale_date: "2026-10-20",
    }),
    // Fechada em outubro, tudo em dezembro.
    os(250, [visita("y", "2026-12-02", 250)], { sale_date: "2026-10-21" }),
    // Fechada em setembro: não entra na projeção de outubro.
    os(500, [visita("z", "2026-11-10", 500)], { sale_date: "2026-09-30" }),
    // Cancelada: não entra.
    os(90, [visita("w", "2026-11-03", 90)], { sale_date: "2026-10-05", status: "Cancelada" }),
  ];
  assert.deepEqual(vendidoParaProximosMeses(fechadas, OUT, HOJE), { valor: 450, quantidade: 2 });
  assert.equal(vendidoNoPeriodo(fechadas, OUT, HOJE).valor, 200);
});
