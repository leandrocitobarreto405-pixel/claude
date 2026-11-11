import { test } from "node:test";
import assert from "node:assert/strict";
import {
  desdeQuando,
  jaTemTarefa,
  lerMarcaVencida,
  marcaVencida,
  motivoParaFechar,
  textoVisitaVencida,
  visitaVencida,
  VALE_DESDE,
} from "./visita-vencida";

const os = { status: "Agendada", deleted_at: null, eh_teste: false };
const v = (status: string, dia: string, retirada: string | null = null) => ({
  status,
  scheduled_date: dia,
  retirada,
});

test("visita vencida: passou da data e segue em aberto (inclui Confirmado)", () => {
  const hoje = "2026-11-16";
  for (const s of ["Agendado", "Confirmado", "Em deslocamento", "Em execução", "Reagendado"])
    assert.equal(visitaVencida(v(s, "2026-11-14"), os, hoje), true, s);
  for (const s of ["Concluído", "Cancelado", "Reagendado com deslocamento"])
    assert.equal(visitaVencida(v(s, "2026-11-14"), os, hoje), false, s);
  // Hoje e futuro não venceram.
  assert.equal(visitaVencida(v("Agendado", hoje), os, hoje), false);
  assert.equal(visitaVencida(v("Agendado", "2026-11-17"), os, hoje), false);
});

test("visita vencida: não entra retirada, OS que não vale, antes do começo da regra nem fora da janela", () => {
  const hoje = "2026-11-16";
  assert.equal(visitaVencida(v("Agendado", "2026-11-14", "tapete"), os, hoje), false);
  assert.equal(visitaVencida(v("Agendado", "2026-11-14"), null, hoje), false);
  assert.equal(visitaVencida(v("Agendado", "2026-11-14"), { ...os, eh_teste: true }, hoje), false);
  assert.equal(
    visitaVencida(v("Agendado", "2026-11-14"), { ...os, deleted_at: "2026-11-15" }, hoje),
    false,
  );
  for (const s of ["Cancelada", "Concluída"])
    assert.equal(visitaVencida(v("Agendado", "2026-11-14"), { ...os, status: s }, hoje), false, s);
  assert.equal(
    visitaVencida(v("Agendado", "2026-11-14"), { ...os, status: "Parcialmente concluída" }, hoje),
    true,
  );
  // Antes do começo da regra.
  assert.equal(visitaVencida(v("Confirmado", "2026-11-09"), os, hoje), false);
  assert.equal(desdeQuando(hoje), VALE_DESDE);
  // Fora da janela de 7 dias.
  assert.equal(desdeQuando("2026-12-10"), "2026-12-03");
  assert.equal(visitaVencida(v("Agendado", "2026-12-02"), os, "2026-12-10"), false);
  assert.equal(visitaVencida(v("Agendado", "2026-12-03"), os, "2026-12-10"), true);
});

test("marca da tarefa: escreve e lê", () => {
  const id = "2fe2c26f-1fed-4c41-949a-c87f960952ba";
  const m = marcaVencida(id, "2026-11-14");
  assert.deepEqual(lerMarcaVencida(`Tatiana: visita vencida ${m}`), {
    visitaId: id,
    dia: "2026-11-14",
  });
  assert.equal(lerMarcaVencida("Tatiana: outra coisa [feriado:x:y]"), null);
  assert.equal(lerMarcaVencida(null), null);
});

test("já tem tarefa: a substituída por outro follow-up volta, até 3 vezes", () => {
  const sub = { status: "Cancelada", result: "substituído por um novo follow-up" };
  assert.equal(jaTemTarefa([]), false);
  assert.equal(jaTemTarefa([{ status: "Pendente", result: null }]), true);
  assert.equal(jaTemTarefa([{ status: "Concluída", result: "feito" }]), true);
  // Pulada pela equipe ou fechada sozinha: não volta.
  assert.equal(jaTemTarefa([{ status: "Cancelada", result: null }]), true);
  assert.equal(jaTemTarefa([sub]), false);
  assert.equal(jaTemTarefa([sub, sub]), false);
  assert.equal(jaTemTarefa([sub, sub, sub]), true);
});

test("fechar sozinha: concluída, cancelada, remarcada ou OS que deixou de valer", () => {
  const dia = "2026-11-14";
  const com = (status: string, d = dia, o: typeof os | null = os) => ({ ...v(status, d), os: o });
  assert.equal(motivoParaFechar(com("Confirmado"), dia), null);
  assert.equal(motivoParaFechar(com("Reagendado"), dia), null);
  assert.equal(motivoParaFechar(null, dia), "a visita não existe mais");
  assert.equal(motivoParaFechar(com("Concluído"), dia), "a visita foi concluída");
  assert.equal(motivoParaFechar(com("Cancelado"), dia), "a visita foi cancelada");
  assert.equal(motivoParaFechar(com("Reagendado", "2026-11-19"), dia), "a visita foi remarcada");
  assert.equal(motivoParaFechar(com("Reagendado com deslocamento"), dia), "a visita foi remarcada");
  assert.equal(
    motivoParaFechar(com("Agendado", dia, { ...os, status: "Cancelada" }), dia),
    "a OS foi concluída ou cancelada",
  );
});

test("texto: com dois horários reais e sem agenda cadastrada", () => {
  const a = textoVisitaVencida({
    nome: "Paula",
    osNumero: "1719",
    dia: "2026-11-14",
    horarios: ["quarta (18/11) às 14h", "sábado (21/11) às 9h"],
  });
  assert.match(a.motivo, /^URGENTE: a visita de 14\/11 \(OS 1719\) passou da data/);
  assert.match(a.motivo, /conclua a OS no app/);
  assert.match(a.mensagem, /^Oi, Paula! /);
  assert.match(a.mensagem, /Tenho quarta \(18\/11\) às 14h ou sábado \(21\/11\) às 9h\./);
  const b = textoVisitaVencida({ nome: "", osNumero: null, dia: "2026-11-14", horarios: null });
  assert.match(b.motivo, /^URGENTE: a visita de 14\/11 passou da data/);
  assert.match(b.mensagem, /^Oi! /);
  assert.match(b.mensagem, /Qual o melhor dia e período/);
  assert.ok(!b.mensagem.includes("—"));
});
