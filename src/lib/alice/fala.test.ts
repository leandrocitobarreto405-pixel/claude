import { test } from "node:test";
import assert from "node:assert/strict";
import { horaPorExtenso, numerosParaFala, porExtenso, reaisPorExtenso } from "./fala";
import { paraFala } from "./voz";

test("números por extenso", () => {
  assert.equal(porExtenso(1), "um");
  assert.equal(porExtenso(21), "vinte e um");
  assert.equal(porExtenso(100), "cem");
  assert.equal(porExtenso(101), "cento e um");
  assert.equal(porExtenso(249), "duzentos e quarenta e nove");
  assert.equal(porExtenso(1000), "mil");
  assert.equal(porExtenso(1036), "mil e trinta e seis");
  assert.equal(porExtenso(1200), "mil e duzentos");
  assert.equal(porExtenso(1714), "mil setecentos e catorze");
  assert.equal(porExtenso(2, "f"), "duas");
  assert.equal(porExtenso(200, "f"), "duzentas");
});

test("reais por extenso", () => {
  assert.equal(reaisPorExtenso(249, 90), "duzentos e quarenta e nove reais e noventa centavos");
  assert.equal(reaisPorExtenso(1, 0), "um real");
  assert.equal(reaisPorExtenso(0, 50), "cinquenta centavos");
  assert.equal(reaisPorExtenso(1036, 80), "mil e trinta e seis reais e oitenta centavos");
});

test("horários do jeito que se fala", () => {
  assert.equal(horaPorExtenso(9), "nove da manhã");
  assert.equal(horaPorExtenso(14, 30), "duas e meia da tarde");
  assert.equal(horaPorExtenso(12), "meio-dia");
  assert.equal(horaPorExtenso(13), "uma da tarde");
  assert.equal(horaPorExtenso(19, 15), "sete e quinze da noite");
});

test("valores, horários, porcentagem, parcelas e m² no texto", () => {
  assert.equal(
    numerosParaFala("Fica R$ 249,90 em até 5x, ou R$ 1.036,80 no Pix com 5% de desconto."),
    "Fica duzentos e quarenta e nove reais e noventa centavos em até cinco vezes, ou mil e trinta e seis reais e oitenta centavos no Pix com cinco por cento de desconto.",
  );
  assert.equal(
    numerosParaFala("O técnico chega das 9h às 10h, ou 14:30."),
    "O técnico chega das nove da manhã às dez da manhã, ou duas e meia da tarde.",
  );
  assert.equal(numerosParaFala("Tapete de 8 m² e 1x"), "Tapete de oito metros quadrados e uma vez");
  assert.equal(numerosParaFala("R$50,00"), "cinquenta reais");
  assert.equal(numerosParaFala("2 fotos e 3 lugares"), "2 fotos e 3 lugares");
});

test("limpeza completa antes de gerar o áudio", () => {
  assert.equal(
    paraFala("*Oi, Marcos!* 💙 Vc pode ver aqui https://exemplo.com.br/x\n\n- Fica R$ 312,00 tbm"),
    "Oi, Marcos! Você pode ver aqui\nFica trezentos e doze reais também",
  );
});
