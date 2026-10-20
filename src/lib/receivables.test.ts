// A receber por OS: total da OS − pagos (com o desconto da OS repartido entre as visitas).
// Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { saldosDaOs, type VisitRaw } from "./receivables";

const HOJE = "2026-10-20";

function v(id: string, status: string, data: string, valor: number, extra: Partial<VisitRaw> = {}) {
  return {
    id,
    status,
    scheduled_date: data,
    completion_date: status === "Concluído" ? data : null,
    visit_value: valor,
    final_value: null,
    discount_amount: 0,
    discount_reason: null,
    work_order_id: "w1",
    technician: null,
    service_type: null,
    upholstery_type: null,
    upholstery_description: null,
    work_order: null,
    ...extra,
  } satisfies VisitRaw;
}

const soma = (l: { balance: number }[]) =>
  Math.round(l.reduce((s, x) => s + x.balance, 0) * 100) / 100;

test("desconto da OS: o saldo é o total da OS, não o valor cheio da visita", () => {
  // Como a OS 1691: visita de R$ 1.012,90, OS fechada em R$ 890,00 (desconto no Pix).
  const r = saldosDaOs(
    { total_gross_value: 890 },
    [v("a", "Agendado", "2026-10-26", 1012.9)],
    0,
    HOJE,
  );
  assert.equal(soma(r), 890);
});

test("soma bate com total − pagos; pago abate primeiro o concluído", () => {
  const r = saldosDaOs(
    { total_gross_value: 900 },
    [v("ag", "Agendado", "2026-10-25", 400), v("ok", "Concluído", "2026-10-10", 600)],
    300,
    HOJE,
  );
  assert.equal(soma(r), 600);
  const concluido = r.find((x) => x.visita.id === "ok")!;
  const agendado = r.find((x) => x.visita.id === "ag")!;
  assert.equal(concluido.value, 540);
  assert.equal(concluido.paid, 300);
  assert.equal(concluido.balance, 240);
  assert.equal(agendado.balance, 360);
});

test("recebimento parcial em duas vezes: o saldo cai a cada pagamento", () => {
  const os = { total_gross_value: 1000 };
  const visitas = [v("a", "Concluído", "2026-10-05", 1000)];
  assert.equal(soma(saldosDaOs(os, visitas, 400, HOJE)), 600);
  assert.equal(soma(saldosDaOs(os, visitas, 1000, HOJE)), 0);
});

test("saldo dispensado sai do a receber; pago a mais não vira saldo negativo", () => {
  const r = saldosDaOs(
    { total_gross_value: 500 },
    [v("a", "Concluído", "2026-10-05", 500, { discount_amount: 50 })],
    0,
    HOJE,
  );
  assert.equal(soma(r), 450);
  const pagoAMais = saldosDaOs(
    { total_gross_value: 500 },
    [v("a", "Concluído", "2026-10-05", 500)],
    700,
    HOJE,
  );
  assert.equal(soma(pagoAMais), 0);
});
