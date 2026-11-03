import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fimAoEncerrar,
  fimDaRepeticao,
  jaLancada,
  planRecurringMonth,
  type RecurringTemplate,
} from "./recurring-core";

const aluguel: RecurringTemplate = {
  id: "t1",
  name: "Aluguel",
  category: "Aluguel",
  default_amount: 1500,
  recurrence: "monthly",
  due_day: 10,
  weekday: null,
  start_date: "2026-11-01",
  end_date: null,
  active: true,
};

test("despesa fixa: até quando repete", () => {
  assert.equal(fimDaRepeticao("2026-11", { modo: "sem_fim" }), null);
  assert.equal(fimDaRepeticao("2026-11", { modo: "ate_mes", mes: "2027-02" }), "2027-02-28");
  assert.equal(fimDaRepeticao("2026-11", { modo: "meses", n: 1 }), "2026-11-30");
  assert.equal(fimDaRepeticao("2026-11", { modo: "meses", n: 3 }), "2027-01-31");
  assert.throws(() => fimDaRepeticao("2026-11", { modo: "ate_mes", mes: "2026-10" }));
  assert.throws(() => fimDaRepeticao("2026-11", { modo: "meses", n: 0 }));
});

test("despesa fixa: encerrar para a partir do mês seguinte, sem esticar um fim anterior", () => {
  assert.equal(fimAoEncerrar("2026-11", null), "2026-11-30");
  assert.equal(fimAoEncerrar("2026-11", "2027-03-31"), "2026-11-30");
  assert.equal(fimAoEncerrar("2026-11", "2026-10-31"), "2026-10-31");
});

test("despesa fixa: gera dentro do período e nunca duplica no mês", () => {
  const nov = planRecurringMonth([aluguel], "2026-11");
  assert.equal(nov.length, 1);
  assert.equal(nov[0]!.dueDate, "2026-11-10");
  assert.equal(planRecurringMonth([{ ...aluguel, end_date: "2026-11-30" }], "2026-12").length, 0);
  assert.equal(planRecurringMonth([aluguel], "2026-10").length, 0);
  const p = nov[0]!;
  // Já lançada no mês (mesmo com outro vencimento, depois de mudar o dia): não gera de novo.
  const outroDia = {
    recurring_expense_id: "t1",
    reference_key: "recurring:t1:2026-11-05",
    due_date: "2026-11-05",
    competence_date: "2026-11-01",
  };
  assert.equal(jaLancada(p, [outroDia]), true);
  // Outro mês ou outro modelo não contam.
  assert.equal(jaLancada(p, [{ ...outroDia, competence_date: "2026-10-01" }]), false);
  assert.equal(
    jaLancada(p, [{ ...outroDia, recurring_expense_id: "t2", reference_key: null }]),
    false,
  );
  // Vencimento no dia 1 continua mensal (um por mês).
  const dia1 = planRecurringMonth([{ ...aluguel, due_day: 1 }], "2026-11")[0]!;
  assert.equal(jaLancada(dia1, [{ ...outroDia, due_date: "2026-11-20" }]), true);
});
