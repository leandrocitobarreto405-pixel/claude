import { test } from "node:test";
import assert from "node:assert/strict";
import { horaDaRevisao, leadsDaRevisao, rotuloSemana, MAX_LEADS_REVISAO } from "./revisao-semanal";
import { codificarAvisos, sugestaoDeCadaAviso } from "./relatorio";

test("revisão semanal: domingo das 22h às 23h29 em São Paulo", () => {
  assert.equal(horaDaRevisao(0, "22:00"), true);
  assert.equal(horaDaRevisao(0, "23:29"), true);
  assert.equal(horaDaRevisao(0, "21:59"), false);
  assert.equal(horaDaRevisao(6, "22:30"), false);
  assert.equal(rotuloSemana("2026-11-08"), "Semana de 02/11 a 08/11");
});

test("leads da revisão: com aviso primeiro, depois 30 da semana, sem repetir, até 40", () => {
  const semana = Array.from({ length: 50 }, (_, i) => `s${i}`);
  const r = leadsDaRevisao(["a1", "s0", "a2"], semana);
  assert.deepEqual(r.slice(0, 4), ["a1", "s0", "a2", "s1"]);
  assert.equal(r.length, 32);
  const muitos = Array.from({ length: 45 }, (_, i) => `a${i}`);
  assert.equal(leadsDaRevisao(muitos, semana).length, MAX_LEADS_REVISAO);
});

test("avisos: códigos A1… e a primeira sugestão que cita cada um", () => {
  const avisos = codificarAvisos([
    { id: "x", tipo: "erro", frase: "pediu tudo junto" },
    { id: "y", tipo: "acerto", frase: "comentou a foto" },
    { id: "z", tipo: "erro", frase: "sem padrão" },
  ]);
  assert.deepEqual(
    avisos.map((a) => a.codigo),
    ["A1", "A2", "A3"],
  );
  assert.deepEqual(
    sugestaoDeCadaAviso(avisos, [{ avisos: ["A2"] }, { avisos: ["A1", "A2"] }, {}]),
    [
      { id: "x", indice: 1 },
      { id: "y", indice: 0 },
      { id: "z", indice: null },
    ],
  );
});
