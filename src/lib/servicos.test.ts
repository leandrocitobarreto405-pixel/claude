import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparPorDia,
  diasDeAtraso,
  emAberto,
  etiquetaPagamento,
  ordenarParaConcluir,
  textoAtraso,
} from "./servicos";

test("em aberto: tudo que não foi concluído nem cancelado", () => {
  assert.equal(emAberto("Agendado"), true);
  assert.equal(emAberto("Em execução"), true);
  assert.equal(emAberto("Reagendado"), true);
  assert.equal(emAberto("Concluído"), false);
  assert.equal(emAberto("Cancelado"), false);
});

test("dias de atraso e texto", () => {
  assert.equal(diasDeAtraso("2026-10-14", "2026-10-14"), 0);
  assert.equal(diasDeAtraso("2026-10-13", "2026-10-14"), 1);
  assert.equal(diasDeAtraso("2026-10-06", "2026-10-14"), 8);
  assert.equal(diasDeAtraso("2026-10-20", "2026-10-14"), 0);
  assert.deepEqual(textoAtraso(0), { rotulo: "Hoje", tom: "neutro" });
  assert.deepEqual(textoAtraso(1), { rotulo: "Atrasado há 1 dia", tom: "problema" });
  assert.deepEqual(textoAtraso(8), { rotulo: "Atrasado há 8 dias", tom: "problema" });
});

test("para concluir: o mais atrasado primeiro, depois o horário", () => {
  const ordem = ordenarParaConcluir([
    { id: "hoje-14h", scheduled_date: "2026-10-14", scheduled_time: "14:00" },
    { id: "ontem", scheduled_date: "2026-10-13", scheduled_time: "16:00" },
    { id: "hoje-9h", scheduled_date: "2026-10-14", scheduled_time: "09:00" },
  ]).map((v) => v.id);
  assert.deepEqual(ordem, ["ontem", "hoje-9h", "hoje-14h"]);
});

test("realizados por dia, do mais recente para o mais antigo", () => {
  const g = agruparPorDia([
    { id: "a", completion_date: "2026-10-10", completion_time: "09:00" },
    { id: "b", completion_date: "2026-10-12", completion_time: "11:00" },
    { id: "c", completion_date: "2026-10-10", completion_time: "15:00" },
  ]);
  assert.deepEqual(
    g.map(([dia, itens]) => [dia, itens.map((i) => i.id)]),
    [
      ["2026-10-12", ["b"]],
      ["2026-10-10", ["c", "a"]],
    ],
  );
});

test("etiqueta: Pago ou A receber com o saldo", () => {
  assert.deepEqual(etiquetaPagamento(0), { rotulo: "Pago", tom: "sucesso", saldo: 0 });
  assert.deepEqual(etiquetaPagamento(undefined), { rotulo: "Pago", tom: "sucesso", saldo: 0 });
  const e = etiquetaPagamento(150.5);
  assert.equal(e.tom, "atencao");
  assert.equal(e.saldo, 150.5);
  assert.match(e.rotulo, /^A receber R\$\s?150,50$/);
});
