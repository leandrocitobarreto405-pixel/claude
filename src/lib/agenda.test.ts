import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chipDoStatus,
  contagemPorDia,
  encerrado,
  historicoDaRemarcacao,
  idAtual,
  rotuloDoMes,
  semanaDe,
  statusParaMostrar,
} from "./agenda";
import { telLink, wazeLink } from "./format";

test("semanaDe: segunda a domingo da semana do dia", () => {
  const s = semanaDe("2026-10-02"); // sexta
  assert.deepEqual(
    s.map((d) => d.iso),
    [
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ],
  );
  assert.deepEqual(
    s.map((d) => d.curto),
    ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"],
  );
  assert.equal(s[0]!.dia, 28);
  // Domingo continua na mesma semana (não começa outra).
  assert.equal(semanaDe("2026-10-04")[0]!.iso, "2026-09-28");
});

test("rotuloDoMes: mês único ou semana que cruza o mês/ano", () => {
  assert.equal(rotuloDoMes(semanaDe("2026-10-14")), "Outubro 2026");
  assert.equal(rotuloDoMes(semanaDe("2026-10-02")), "Set – Out 2026");
  assert.equal(rotuloDoMes(semanaDe("2026-12-31")), "Dez 2026 – Jan 2027");
});

test("chipDoStatus: etiquetas curtas e tons", () => {
  assert.deepEqual(chipDoStatus("Concluído"), { rotulo: "Feito", tom: "sucesso" });
  assert.deepEqual(chipDoStatus("Em deslocamento"), { rotulo: "A caminho", tom: "atencao" });
  assert.deepEqual(chipDoStatus("Cancelado"), { rotulo: "Cancelado", tom: "problema" });
  assert.deepEqual(chipDoStatus("Reagendado com deslocamento"), {
    rotulo: "Reagendado",
    tom: "atencao",
  });
  assert.deepEqual(chipDoStatus("Agendado"), { rotulo: "Agendado", tom: "neutro" });
  assert.deepEqual(chipDoStatus("Reagendado"), { rotulo: "Agendado", tom: "neutro" });
  assert.equal(statusParaMostrar("Reagendado"), "Agendado");
  assert.equal(statusParaMostrar("Confirmado"), "Confirmado");
  assert.equal(
    historicoDaRemarcacao({
      status: "Agendado",
      scheduled_date: "2026-11-18",
      original_scheduled_date: "2026-11-09",
    }),
    "remarcado de seg 09/11",
  );
  assert.equal(historicoDaRemarcacao({ status: "Agendado", scheduled_date: "2026-11-18" }), null);
  assert.equal(
    historicoDaRemarcacao({
      status: "Reagendado com deslocamento",
      scheduled_date: "2026-11-09",
      original_scheduled_date: "2026-11-09",
    }),
    null,
  );
});

test("idAtual: hoje abre o primeiro não encerrado; outros dias, nenhum", () => {
  const itens = [
    { id: "c", status: "Agendado", time: "14:00:00" },
    { id: "a", status: "Concluído", time: "08:30:00" },
    { id: "b", status: "Em deslocamento", time: "10:30:00" },
  ];
  assert.equal(idAtual(itens, "2026-10-02", "2026-10-02"), "b");
  assert.equal(idAtual(itens, "2026-10-03", "2026-10-02"), null);
  assert.equal(
    idAtual([{ id: "a", status: "Concluído", time: "08:00" }], "2026-10-02", "2026-10-02"),
    null,
  );
  // Visita remarcada é agendamento normal no dia novo: não é encerrada e pode ser a próxima.
  assert.equal(encerrado("Reagendado"), false);
  assert.equal(encerrado("Reagendado com deslocamento"), true);
  assert.equal(
    idAtual([{ id: "r", status: "Reagendado", time: "09:00" }], "2026-10-02", "2026-10-02"),
    "r",
  );
  assert.equal(encerrado("Confirmado"), false);
});

test("contagemPorDia ignora cancelados", () => {
  const m = contagemPorDia([
    { date: "2026-10-01", status: "Agendado" },
    { date: "2026-10-01", status: "Cancelado" },
    { date: "2026-10-01", status: "Concluído" },
    { date: "2026-10-02", status: "Cancelado" },
  ]);
  assert.equal(m.get("2026-10-01"), 2);
  assert.equal(m.get("2026-10-02"), undefined);
});

test("links de Waze e de ligação", () => {
  assert.equal(wazeLink("Rua A, 10"), "https://waze.com/ul?q=Rua%20A%2C%2010&navigate=yes");
  assert.equal(wazeLink(null), null);
  assert.equal(telLink("(11) 98888-7777"), "tel:11988887777");
  assert.equal(telLink("123"), null);
});
