import { test } from "node:test";
import assert from "node:assert/strict";
import {
  caiEmDiaUtil,
  diasBloqueados,
  diasEntre,
  etapaDaPergunta,
  feriadosPadrao,
  pascoa,
  textoPergunta,
  textoRemarcarFeriado,
} from "./feriados";

test("Páscoa e feriados móveis", () => {
  assert.equal(pascoa(2026), "2026-04-05");
  assert.equal(pascoa(2027), "2027-03-28");
  assert.equal(pascoa(2025), "2025-04-20");
  const f = feriadosPadrao(2026);
  const por = new Map(f.map((x) => [x.nome, x.data]));
  assert.equal(por.get("Carnaval (segunda)"), "2026-02-16");
  assert.equal(por.get("Carnaval (terça)"), "2026-02-17");
  assert.equal(por.get("Sexta-feira Santa"), "2026-04-03");
  assert.equal(por.get("Corpus Christi"), "2026-06-04");
  assert.equal(por.get("Finados"), "2026-11-02");
  assert.equal(por.get("Dia da Consciência Negra"), "2026-11-20");
  assert.equal(f.length, 15);
  // Ordenado por data e sem data repetida.
  assert.deepEqual(
    f.map((x) => x.data),
    [...f.map((x) => x.data)].sort(),
  );
  assert.equal(new Set(f.map((x) => x.data)).size, f.length);
  // Até o fim de 2026, a partir de 02/11: Finados, Proclamação, Consciência Negra e Natal.
  assert.deepEqual(
    f.filter((x) => x.data >= "2026-11-02").map((x) => x.data),
    ["2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"],
  );
});

test("dias bloqueados: sem decisão ou 'não vamos' bloqueia; 'vamos trabalhar' libera", () => {
  const m = diasBloqueados([
    { data: "2026-11-15", nome: "Proclamação da República", trabalhamos: null },
    { data: "2026-11-20", nome: "Dia da Consciência Negra", trabalhamos: true },
    { data: "2026-12-25", nome: "Natal", trabalhamos: false },
  ]);
  assert.deepEqual([...m.keys()], ["2026-11-15", "2026-12-25"]);
  assert.equal(m.get("2026-12-25"), "Natal");
});

test("etapa da pergunta: 3 semanas antes pergunta, 3 dias lembra, véspera aplica o padrão", () => {
  const f = { data: "2026-11-20", trabalhamos: null };
  assert.equal(etapaDaPergunta(f, "2026-10-29"), null);
  assert.equal(etapaDaPergunta(f, "2026-10-30"), "pergunta");
  assert.equal(etapaDaPergunta(f, "2026-11-02"), "pergunta");
  assert.equal(etapaDaPergunta(f, "2026-11-16"), "pergunta");
  assert.equal(etapaDaPergunta(f, "2026-11-17"), "lembrete");
  assert.equal(etapaDaPergunta(f, "2026-11-19"), "padrao");
  assert.equal(etapaDaPergunta(f, "2026-11-20"), "padrao");
  assert.equal(etapaDaPergunta(f, "2026-11-21"), null);
  assert.equal(etapaDaPergunta({ ...f, trabalhamos: false }, "2026-11-18"), null);
  assert.equal(diasEntre("2026-11-02", "2026-11-20"), 18);
});

test("textos: pergunta, lembrete, padrão e remarcar", () => {
  const f = { data: "2026-11-20", nome: "Dia da Consciência Negra" };
  assert.equal(textoPergunta(f, "pergunta").titulo, "Feriado 20/11: vamos trabalhar?");
  assert.match(
    textoPergunta(f, "pergunta").corpo,
    /^Dia 20\/11 \(sexta\) é feriado: Dia da Consciência Negra\. Vamos trabalhar\?$/,
  );
  assert.match(textoPergunta(f, "lembrete").corpo, /Sem resposta até a véspera/);
  assert.match(textoPergunta(f, "padrao").corpo, /Valeu o padrão: dia bloqueado/);
  const r = textoRemarcarFeriado(f, "1702");
  assert.match(r.motivo, /^OS 1702 marcado em 20\/11, feriado bloqueado/);
  assert.match(r.mensagem, /não vamos atender/);
  assert.doesNotMatch(r.mensagem, /Tatiana/);
});

test("feriado fora dos dias de atendimento não gera pergunta (15/11/2026 é domingo)", () => {
  assert.equal(caiEmDiaUtil("2026-11-15", null), false);
  assert.equal(caiEmDiaUtil("2026-11-20", null), true);
  assert.equal(caiEmDiaUtil("2026-11-21", [1, 2, 3, 4, 5]), false); // sábado, empresa seg–sex
  assert.equal(caiEmDiaUtil("2026-11-21", [1, 2, 3, 4, 5, 6]), true);
});
