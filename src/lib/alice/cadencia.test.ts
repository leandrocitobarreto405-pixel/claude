import { test } from "node:test";
import assert from "node:assert/strict";
import {
  doisHorarios,
  horarioDoPasso,
  instanteSP,
  passoDaEtapa,
  ancoraDoOrcamento,
  planejarToque,
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

const SP = (d: string) => new Date(`${d}-03:00`);
const base = {
  oferta: false,
  ultimaDoCliente: null as Date | null,
  retorno: null as Date | null,
};

test("6066: cliente respondeu depois do orçamento → nada de A1 de novo; o próximo é o D1 10h", () => {
  const p = planejarToque({
    ...base,
    trilha: "A",
    agora: SP("2026-10-27T19:06:43"),
    ancoraOrcamento: SP("2026-10-27T18:50:38"),
    feitos: [{ etapa: "A1", em: SP("2026-10-27T19:00:53").toISOString() }],
    ultimaDoCliente: SP("2026-10-27T19:06:30"),
  })!;
  assert.equal(p.passo.etapa, "A3");
  assert.equal(p.quando.toISOString(), SP("2026-10-28T10:00:00").toISOString());
});

test("trilha começa uma vez: sem resposta depois do orçamento, A1 +10 e A2 +40 do orçamento", () => {
  const ancora = SP("2026-10-27T18:50:38");
  const a1 = planejarToque({
    ...base,
    trilha: "A",
    agora: ancora,
    ancoraOrcamento: ancora,
    feitos: [],
  })!;
  assert.equal(a1.passo.etapa, "A1");
  assert.equal(a1.quando.toISOString(), SP("2026-10-27T19:00:38").toISOString());
  const a2 = planejarToque({
    ...base,
    trilha: "A",
    agora: SP("2026-10-27T19:00:53"),
    ancoraOrcamento: ancora,
    feitos: [{ etapa: "A1", em: SP("2026-10-27T19:00:53").toISOString() }],
  })!;
  assert.equal(a2.passo.etapa, "A2");
  assert.equal(a2.quando.toISOString(), SP("2026-10-27T19:30:38").toISOString());
});

test("etapa feita não se repete e, depois do primeiro dia, 4 h entre toques; vence amanhã atrasado não sai", () => {
  const p = planejarToque({
    ...base,
    trilha: "A",
    agora: SP("2026-10-29T15:00:00"),
    ancoraOrcamento: SP("2026-10-27T18:50:38"),
    feitos: [
      { etapa: "A1", em: SP("2026-10-27T19:00:53").toISOString() },
      { etapa: "A2", em: SP("2026-10-27T19:30:53").toISOString() },
      { etapa: "A3", em: SP("2026-10-29T13:00:00").toISOString() },
    ],
    ultimaDoCliente: SP("2026-10-28T09:00:00"),
  })!;
  // A4 ("vence amanhã") era 28/10 14h: atrasado, não sai. Sem oferta, vai o fim (D3 10h).
  assert.equal(p.passo.etapa, "A_FIM");
  assert.equal(p.quando.toISOString(), SP("2026-10-30T10:00:00").toISOString());
});

test("0909: retorno combinado sem resposta → próximo só 2 dias depois, às 10h", () => {
  const p = planejarToque({
    ...base,
    trilha: "A",
    agora: SP("2026-10-28T10:00:24"),
    ancoraOrcamento: SP("2026-10-27T14:48:56"),
    feitos: [],
    ultimaDoCliente: SP("2026-10-27T14:54:43"),
    retorno: SP("2026-10-28T10:00:24"),
  })!;
  assert.equal(p.passo.etapa, "A3");
  assert.equal(p.quando.toISOString(), SP("2026-10-30T10:00:00").toISOString());
});

test("depois do retorno, sem toque sobrando na trilha: toque espaçado e o fim 2 dias depois", () => {
  const feitos = ["A1", "A2", "A3", "A4"].map((etapa, i) => ({
    etapa,
    em: SP(`2026-10-2${i}T10:00:00`).toISOString(),
  }));
  const ae = planejarToque({
    ...base,
    trilha: "A",
    agora: SP("2026-11-02T10:00:00"),
    ancoraOrcamento: SP("2026-10-20T09:00:00"),
    feitos,
    retorno: SP("2026-11-02T10:00:00"),
  })!;
  assert.equal(ae.passo.etapa, "AE");
  assert.equal(ae.quando.toISOString(), SP("2026-11-04T10:00:00").toISOString());
  const fim = planejarToque({
    ...base,
    trilha: "A",
    agora: SP("2026-11-04T10:00:30"),
    ancoraOrcamento: SP("2026-10-20T09:00:00"),
    feitos: [...feitos, { etapa: "AE", em: SP("2026-11-04T10:00:30").toISOString() }],
  })!;
  assert.equal(fim.passo.etapa, "AE_FIM");
  assert.equal(fim.quando.toISOString(), SP("2026-11-06T10:00:00").toISOString());
});

test("novo orçamento (outro valor) recomeça a trilha; o mesmo valor refeito, não", () => {
  assert.equal(
    ancoraDoOrcamento([
      { created_at: "2026-10-27T10:00:00Z", total: 300 },
      { created_at: "2026-10-27T11:00:00Z", total: 300 },
    ])!.toISOString(),
    "2026-10-27T10:00:00.000Z",
  );
  assert.equal(
    ancoraDoOrcamento([
      { created_at: "2026-10-27T10:00:00Z", total: 300 },
      { created_at: "2026-10-28T11:00:00Z", total: 450 },
    ])!.toISOString(),
    "2026-10-28T11:00:00.000Z",
  );
});

test("trilha B: B1 uma vez; cliente respondeu hoje depois do B1 → próximo amanhã às 10h", () => {
  const p = planejarToque({
    ...base,
    trilha: "B",
    agora: SP("2026-10-27T17:56:40"),
    ancoraOrcamento: null,
    feitos: [{ etapa: "B1", em: SP("2026-10-27T17:48:33").toISOString() }],
    ultimaDoCliente: SP("2026-10-27T17:56:17"),
  })!;
  assert.equal(p.passo.etapa, "B3");
  assert.equal(p.quando.toISOString(), SP("2026-10-28T10:00:00").toISOString());
});
