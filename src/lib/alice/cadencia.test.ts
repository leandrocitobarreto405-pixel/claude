import { test } from "node:test";
import assert from "node:assert/strict";
import {
  doisHorarios,
  horarioDoPasso,
  instanteSP,
  passoDaEtapa,
  primeiraConversa,
  primeiroPasso,
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
  // Dia de semana primeiro: o segundo é o sábado (mesmo havendo outro dia de semana antes).
  assert.deepEqual(
    doisHorarios([
      { data: "2026-10-29", livres: [{ hora: "10:00" }, { hora: "14:30" }] },
      { data: "2026-10-30", livres: [{ hora: "09:00" }] },
      { data: "2026-10-31", livres: [{ hora: "09:00" }, { hora: "14:00" }] },
    ]),
    ["quinta (29/10) às 10h", "sábado (31/10) às 9h"],
  );
  // Sábado primeiro (dias de semana cheios): o segundo é o próximo dia de semana, nunca o mesmo
  // sábado à tarde.
  assert.deepEqual(
    doisHorarios([
      { data: "2026-10-31", livres: [{ hora: "09:00" }, { hora: "14:00" }] },
      { data: "2026-11-07", livres: [{ hora: "09:00" }] },
      { data: "2026-11-03", livres: [{ hora: "10:00" }] },
    ]),
    ["sábado (31/10) às 9h", "terça (03/11) às 10h"],
  );
  // Sem dia de semana livre: o próximo sábado.
  assert.deepEqual(
    doisHorarios([
      { data: "2026-10-31", livres: [{ hora: "09:00" }] },
      { data: "2026-11-07", livres: [{ hora: "09:00" }] },
    ]),
    ["sábado (31/10) às 9h", "sábado (07/11) às 9h"],
  );
  // Só um dia com vaga: dois horários do mesmo dia.
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

test("trilha espaçada (0909): depois do retorno combinado, um toque 2 dias depois às 10h e o fim 2 dias depois", () => {
  const p = primeiroPasso("A", { oferta: true, espacada: true })!;
  assert.equal(p.etapa, "AE");
  const ancora = new Date("2026-10-28T13:00:24Z"); // retorno combinado às 10:00 de 28/10
  assert.equal(
    horarioDoPasso(p, ancora, ancora).toISOString(),
    "2026-10-30T13:00:00.000Z", // 30/10 10h, nunca 10:10 nem 10:40
  );
  const fim = proximoPasso("A", "AE", { oferta: true })!;
  assert.equal(fim.etapa, "AE_FIM");
  assert.ok(fim.fim);
  assert.equal(horarioDoPasso(fim, ancora, ancora).toISOString(), "2026-11-01T13:00:00.000Z");
  assert.equal(proximoPasso("A", "AE_FIM", { oferta: true }), null);
  assert.equal(primeiroPasso("B", { oferta: false, espacada: true })!.etapa, "BE");
  assert.equal(passoDaEtapa("BE_FIM")!.fim, true);
  // Sem espaçar: a trilha normal começa no +10 min.
  assert.equal(primeiroPasso("A", { oferta: true, espacada: false })!.etapa, "A1");
});

test("+10 e +40 min só na primeira conversa (até 24 h do orçamento ou do primeiro contato)", () => {
  const agora = new Date("2026-10-28T13:00:00Z");
  assert.equal(
    primeiraConversa("A", { orcamento_enviado_em: "2026-10-28T11:00:00Z" }, agora),
    true,
  );
  assert.equal(
    primeiraConversa("A", { orcamento_enviado_em: "2026-10-27T11:00:00Z" }, agora),
    false,
  );
  assert.equal(primeiraConversa("B", { created_at: "2026-10-20T11:00:00Z" }, agora), false);
  assert.equal(primeiraConversa("B", { created_at: null }, agora), true);
});
