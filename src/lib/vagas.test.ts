import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diasDoAlarme,
  linhaDoResumo,
  mensagemDaVaga,
  ordenarCandidatos,
  pecaNovinha,
  pushDaHora,
  rotuloDoDia,
  textoDaFaixa,
  textoDoPush,
  tituloDaVaga,
  vagasAbertas,
  type CandidatoDaVaga,
  type Vaga,
} from "./vagas";

// Técnico fictício: seg a sáb, 9h e 14h. 11/11/2026 é quarta.
const base = [1, 2, 3, 4, 5, 6].flatMap((d) =>
  ["09:00", "14:00"].map((hora) => ({ tecnicoId: "t1", tecnico: "Técnico", diaSemana: d, hora })),
);
const oc = (data: string, hora: string, extra: Record<string, unknown> = {}) => ({
  data,
  hora,
  tecnicoId: "t1",
  status: "Agendado",
  valor: 300,
  ocupaDia: null,
  ...extra,
});
const semBloqueio = new Map<string, string>();

test("dias do alarme: hoje e os dois próximos dias de atendimento, pulando domingo e feriado", () => {
  assert.deepEqual(diasDoAlarme("2026-11-11", base, semBloqueio), [
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
  ]);
  // Sábado 14/11: domingo não atende; segunda e terça entram.
  assert.deepEqual(diasDoAlarme("2026-11-14", base, semBloqueio), [
    "2026-11-14",
    "2026-11-16",
    "2026-11-17",
  ]);
  // Feriado bloqueado em 20/11 (sexta): quinta 19 olha sábado 21 e segunda 23.
  assert.deepEqual(
    diasDoAlarme("2026-11-19", base, new Map([["2026-11-20", "Consciência Negra"]])),
    ["2026-11-19", "2026-11-21", "2026-11-23"],
  );
  // Sem horário base: sem alarme.
  assert.deepEqual(diasDoAlarme("2026-11-11", [], semBloqueio), []);
});

test("vagas: horário livre pela regra de ocupação; hoje só com 3 h de folga", () => {
  const vagas = vagasAbertas({
    agora: { data: "2026-11-11", hora: "10:00" },
    base,
    ocupacoes: [
      oc("2026-11-11", "09:00"),
      oc("2026-11-12", "09:00"),
      // Visita das 16h ocupa o horário das 14h.
      oc("2026-11-12", "16:00"),
      // Dia inteiro (valor acima da regra): sem vaga em 13/11.
      oc("2026-11-13", "09:00", { valor: 1500 }),
    ],
    bloqueados: semBloqueio,
  });
  // Hoje às 14h vale (faltam 4 h); amanhã e sexta cheios.
  assert.deepEqual(
    vagas.map((v) => `${v.data} ${v.hora}`),
    ["2026-11-11 14:00"],
  );
  // Às 11h30 a vaga de hoje às 14h não conta mais (menos de 3 h).
  assert.deepEqual(
    vagasAbertas({
      agora: { data: "2026-11-11", hora: "11:30" },
      base,
      ocupacoes: [oc("2026-11-12", "09:00"), oc("2026-11-12", "14:00"), oc("2026-11-13", "09:00")],
      bloqueados: semBloqueio,
    }).map((v) => `${v.data} ${v.hora}`),
    ["2026-11-13 14:00"],
  );
  // Cancelado e reagendado com deslocamento não ocupam; reagendado ocupa.
  const v2 = vagasAbertas({
    agora: { data: "2026-11-11", hora: "20:00" },
    base,
    ocupacoes: [
      oc("2026-11-12", "09:00", { status: "Cancelado" }),
      oc("2026-11-12", "14:00", { status: "Reagendado" }),
      oc("2026-11-13", "09:00"),
      oc("2026-11-13", "14:00"),
    ],
    bloqueados: semBloqueio,
  });
  assert.deepEqual(
    v2.map((v) => `${v.data} ${v.hora}`),
    ["2026-11-12 09:00"],
  );
});

const vaga = (data: string, hora: string): Vaga => ({ data, hora, tecnicoId: "t1", tecnico: "T" });

test("faixa, título e push", () => {
  const hoje = "2026-11-10";
  assert.equal(textoDaFaixa([], hoje), null);
  assert.equal(
    textoDaFaixa([vaga("2026-11-11", "09:00"), vaga("2026-11-13", "14:00")], hoje),
    "Vaga aberta amanhã (qua 11/11) às 9h · Vaga aberta sexta 13/11 às 14h. Agenda vazia é dinheiro perdido.",
  );
  assert.equal(
    textoDaFaixa([vaga("2026-11-10", "14:00"), vaga("2026-11-10", "16:30")], hoje),
    "Vaga aberta hoje às 14h e 16h30. Agenda vazia é dinheiro perdido.",
  );
  assert.equal(rotuloDoDia("2026-11-12", hoje), "quinta 12/11");
  assert.equal(
    linhaDoResumo([vaga("2026-11-11", "09:00"), vaga("2026-11-13", "14:00")], hoje),
    "Vagas abertas: amanhã (qua 11/11) às 9h; sexta 13/11 às 14h.",
  );
  assert.equal(linhaDoResumo([], hoje), null);
  assert.equal(
    tituloDaVaga(vaga("2026-11-11", "09:00"), hoje),
    "Preencher a vaga de amanhã (qua 11/11) às 9h",
  );
  assert.deepEqual(textoDoPush([vaga("2026-11-11", "09:00")], hoje, 6), {
    titulo: "Amanhã tem vaga às 9h: 6 clientes para chamar",
    corpo: "Agenda vazia é dinheiro perdido.",
  });
  const p = textoDoPush([vaga("2026-11-11", "09:00"), vaga("2026-11-12", "14:00")], hoje, 1)!;
  assert.equal(p.titulo, "Amanhã tem vaga às 9h: 1 cliente para chamar");
  assert.match(p.corpo, /^E mais 1 dia com vaga\./);
  assert.equal(textoDoPush([], hoje, 3), null);
});

test("push só nos horários marcados (janela de 30 min)", () => {
  assert.equal(pushDaHora("08:29"), null);
  assert.equal(pushDaHora("08:30"), "08:30");
  assert.equal(pushDaHora("08:59"), "08:30");
  assert.equal(pushDaHora("09:00"), null);
  assert.equal(pushDaHora("10:42"), "10:30");
  assert.equal(pushDaHora("13:30"), "13:30");
  assert.equal(pushDaHora("16:05"), "16:00");
  assert.equal(pushDaHora("16:30"), null);
});

test("quem chamar: ordem dos grupos, sem repetir a pessoa, e a mensagem pronta", () => {
  const c = (grupo: CandidatoDaVaga["grupo"], chave: string, quando: string): CandidatoDaVaga => ({
    grupo,
    chave,
    nome: chave,
    detalhe: "",
    estofado: null,
    conversaId: null,
    leadId: null,
    quando,
  });
  const lista = ordenarCandidatos([
    c("orcamento", "ana", "2026-11-09"),
    c("adiantar", "bia", "2026-11-20"),
    c("negociacao", "caio", "2026-11-08"),
    c("remarcar", "duda", "2026-11-09"),
    c("negociacao", "duda", "2026-11-10"),
    c("orcamento", "eva", "2026-11-10"),
  ]);
  assert.deepEqual(
    lista.map((x) => `${x.grupo}:${x.chave}`),
    ["remarcar:duda", "negociacao:caio", "adiantar:bia", "orcamento:eva", "orcamento:ana"],
  );
  const hoje = "2026-11-10";
  const v = vaga("2026-11-11", "09:00");
  assert.equal(
    mensagemDaVaga({ nome: "fulana de tal", grupo: "orcamento", vaga: v, hoje, estofado: "Sofá" }),
    "Oi, Fulana! Abriu um horário amanhã às 9h. Quer aproveitar e já deixar seu sofá novinho?",
  );
  assert.equal(
    mensagemDaVaga({ nome: "5511999990000", grupo: "negociacao", vaga: v, hoje, estofado: null }),
    "Oi! Abriu um horário amanhã às 9h. Quer aproveitar e já deixar tudo novinho?",
  );
  assert.match(
    mensagemDaVaga({
      nome: "Bia",
      grupo: "adiantar",
      vaga: vaga("2026-11-13", "14:00"),
      hoje,
      estofado: null,
    }),
    /^Oi, Bia! Abriu um horário sexta \(13\/11\) às 14h\. Quer adiantar/,
  );
  assert.match(
    mensagemDaVaga({ nome: "Duda", grupo: "remarcar", vaga: v, hoje, estofado: null }),
    /Quer que eu já reserve pra você/,
  );
  assert.equal(pecaNovinha("Higienização de colchão casal"), "seu colchão novinho");
  assert.equal(pecaNovinha("Poltrona do papai"), "sua poltrona novinha");
  assert.equal(pecaNovinha("6 cadeiras de jantar"), "suas cadeiras novinhas");
  assert.equal(pecaNovinha("Impermeabilização"), "tudo novinho");
});
