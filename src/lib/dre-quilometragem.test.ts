import { test } from "node:test";
import assert from "node:assert/strict";
import { despesaDeRota } from "./dre-quilometragem";

test("DRE: despesa de quilometragem das rotas não conta duas vezes", () => {
  assert.equal(
    despesaDeRota({ reference_key: "mileage:tec-1:2026-10" }),
    true,
    "fechamento mensal",
  );
  assert.equal(
    despesaDeRota({ reference_key: "mileage:equipe:2026-10-07" }),
    true,
    "lançamento diário",
  );
  assert.equal(despesaDeRota({ reference_key: null }), false, "despesa manual");
  assert.equal(despesaDeRota({ reference_key: "recorrente:aluguel" }), false);

  // Outubro: rateio de R$ 54,95 nos serviços + despesa de R$ 54,95 paga ao técnico + aluguel.
  const rateioNosServicos = 54.95;
  const despesas = [
    { reference_key: "mileage:tec-1:2026-10", pago: 54.95 },
    { reference_key: null, pago: 1000 },
  ];
  const despesasNoDre = despesas.filter((d) => !despesaDeRota(d)).reduce((s, d) => s + d.pago, 0);
  assert.equal(rateioNosServicos + despesasNoDre, 1054.95, "o km entra uma vez só");
});
