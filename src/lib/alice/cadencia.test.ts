import { test } from "node:test";
import assert from "node:assert/strict";
import {
  doisHorarios,
  horarioDoPasso,
  instanteSP,
  passoDaEtapa,
  proximoPasso,
  travaDoLead,
  trilhaDoLead,
} from "./cadencia";

test("trilha A: 10 min, 40 min, D1 10h, D1 14h, D2 16h (com oferta) e fim no D3", () => {
  const etapas: string[] = [];
  let e: string | null = null;
  for (;;) {
    const p = proximoPasso("A", e, { oferta: true });
    if (!p) break;
    etapas.push(p.etapa);
    e = p.etapa;
  }
  assert.deepEqual(etapas, ["A1", "A2", "A3", "A4", "A5", "A_FIM"]);
});

test("sem a oferta ligada, o A5 é pulado (e uma etapa A5 antiga segue para o fim)", () => {
  assert.equal(proximoPasso("A", "A4", { oferta: false })?.etapa, "A_FIM");
  assert.equal(proximoPasso("A", "A5", { oferta: false })?.etapa, "A_FIM");
  assert.equal(proximoPasso("A", "A_FIM", { oferta: false }), null);
});

test("trilha B: 10 min, 40 min, D1 10h, D2 16h e fim", () => {
  assert.equal(proximoPasso("B", null, { oferta: true })?.etapa, "B1");
  assert.equal(proximoPasso("B", "B3", { oferta: true })?.etapa, "B4");
  assert.equal(proximoPasso("B", "B4", { oferta: true })?.etapa, "B_FIM");
});

test("horários contados da resposta da Alice, em São Paulo", () => {
  const ancora = new Date("2026-10-27T18:30:00Z"); // 15h30 em SP
  const agora = ancora;
  assert.equal(
    horarioDoPasso(passoDaEtapa("A1")!, ancora, agora).toISOString(),
    "2026-10-27T18:40:00.000Z",
  );
  assert.equal(
    horarioDoPasso(passoDaEtapa("A2")!, ancora, agora).toISOString(),
    "2026-10-27T19:10:00.000Z",
  );
  assert.equal(
    horarioDoPasso(passoDaEtapa("A3")!, ancora, agora).toISOString(),
    "2026-10-28T13:00:00.000Z",
  );
  assert.equal(
    horarioDoPasso(passoDaEtapa("A4")!, ancora, agora).toISOString(),
    "2026-10-28T17:00:00.000Z",
  );
  assert.equal(
    horarioDoPasso(passoDaEtapa("A5")!, ancora, agora).toISOString(),
    "2026-10-29T19:00:00.000Z",
  );
  // resposta às 23h em SP (já é o dia seguinte em UTC): D1 continua sendo o dia seguinte em SP
  const noite = new Date("2026-10-28T02:00:00Z");
  assert.equal(
    horarioDoPasso(passoDaEtapa("A3")!, noite, noite).toISOString(),
    "2026-10-28T13:00:00.000Z",
  );
});

test("passo atrasado vai para agora + 5 min", () => {
  const ancora = new Date("2026-10-27T18:30:00Z");
  const agora = new Date("2026-10-28T15:00:00Z"); // já passou das 10h do D1
  assert.equal(
    horarioDoPasso(passoDaEtapa("A3")!, ancora, agora).toISOString(),
    "2026-10-28T15:05:00.000Z",
  );
});

test("virada de mês no D+n", () => {
  assert.equal(instanteSP("2026-10-31", 1, 10).toISOString(), "2026-11-01T13:00:00.000Z");
});

test("trilha pelo lead e trava", () => {
  assert.equal(trilhaDoLead({ orcamento_enviado_em: "2026-10-27" }), "A");
  assert.equal(trilhaDoLead({ orcamento_enviado_em: null }), "B");
  assert.equal(travaDoLead({ is_open: true }), null);
  assert.match(travaDoLead({ perdido_em: "x" })!, /perdido/);
  assert.match(travaDoLead({ linked_work_order_id: "x" })!, /OS/);
  assert.match(travaDoLead({ agendado_em: "x" })!, /agendou/);
  assert.match(travaDoLead({ is_open: false })!, /encerrado/);
});

test("dois horários reais em dias diferentes", () => {
  assert.deepEqual(
    doisHorarios([
      { data: "2026-10-29", livres: [{ hora: "10:00" }, { hora: "14:30" }] },
      { data: "2026-10-30", livres: [{ hora: "09:00" }] },
    ]),
    ["quinta (29/10) às 10h", "sexta (30/10) às 9h"],
  );
  assert.deepEqual(
    doisHorarios([{ data: "2026-10-29", livres: [{ hora: "10:00" }, { hora: "14:30" }] }]),
    ["quinta (29/10) às 10h", "quinta (29/10) às 14h30"],
  );
  assert.equal(doisHorarios([{ data: "2026-10-29", livres: [{ hora: "10:00" }] }]), null);
  assert.equal(doisHorarios([]), null);
});

test("retomada: um toque só, com modelo e horários", () => {
  const r = passoDaEtapa("R")!;
  assert.equal(r.modelo, "fu_retomada_horarios");
  assert.equal(r.horarios, true);
});
