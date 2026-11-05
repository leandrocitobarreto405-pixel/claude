import { test } from "node:test";
import assert from "node:assert/strict";
import { fraseDeConcorrencia, retornoVencido, valorCitado } from "./tempo-real";

test("tempo real: cliente citando concorrente ou preço menor", () => {
  assert.equal(
    fraseDeConcorrencia("olha, eu recebi um orçamento melhor da são paulo limp, que ficou 460,00"),
    true,
  );
  assert.equal(fraseDeConcorrencia("achei mais barato no Google"), true);
  assert.equal(fraseDeConcorrencia("fechei com uma empresa que vem amanhã"), true);
  assert.equal(fraseDeConcorrencia("pode ser na quinta de manhã?"), false);
  assert.equal(valorCitado("ficou o total de 460,00"), "R$ 460,00");
  assert.equal(valorCitado("cobram R$ 249 lá"), "R$ 249");
  assert.equal(valorCitado("mais barato"), null);
});

test("tempo real: retorno prometido vira P1 às 15h do dia, sem resposta", () => {
  const base = { hoje: "2026-11-05", respondeuDepois: false, jaCobrado: false };
  assert.equal(retornoVencido({ ...base, prometidoEm: "2026-11-05", hora: "14:59" }), false);
  assert.equal(retornoVencido({ ...base, prometidoEm: "2026-11-05", hora: "15:00" }), true);
  assert.equal(retornoVencido({ ...base, prometidoEm: "2026-11-04", hora: "09:00" }), true);
  assert.equal(retornoVencido({ ...base, prometidoEm: "2026-11-06", hora: "16:00" }), false);
  assert.equal(
    retornoVencido({ ...base, prometidoEm: "2026-11-05", hora: "16:00", respondeuDepois: true }),
    false,
  );
});
