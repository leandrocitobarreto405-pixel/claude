import { test } from "node:test";
import assert from "node:assert/strict";
import {
  condicoesPagamento,
  dataHoraTexto,
  dentroDaJanela,
  dentroDoHorario,
  lerDataHoraLocal,
  normalizarNome,
  proximoHorarioPermitido,
  textoInterno,
  validade,
} from "./regras";

// São Paulo = UTC-3.
const sp = (iso: string) => new Date(`${iso}-03:00`);

test("horário permitido: dentro fica; antes vai para o início; depois vai para amanhã", () => {
  assert.equal(
    proximoHorarioPermitido(sp("2026-09-29T14:00"), 8, 21).toISOString(),
    sp("2026-09-29T14:00").toISOString(),
  );
  assert.equal(
    proximoHorarioPermitido(sp("2026-09-29T06:30"), 8, 21).toISOString(),
    sp("2026-09-29T08:00").toISOString(),
  );
  assert.equal(
    proximoHorarioPermitido(sp("2026-09-29T21:00"), 8, 21).toISOString(),
    sp("2026-09-30T08:00").toISOString(),
  );
  assert.equal(
    proximoHorarioPermitido(sp("2026-09-30T23:59"), 8, 21).toISOString(),
    sp("2026-10-01T08:00").toISOString(),
  );
  assert.equal(dentroDoHorario(sp("2026-09-29T20:59"), 8, 21), true);
  assert.equal(dentroDoHorario(sp("2026-09-29T21:00"), 8, 21), false);
  assert.equal(dentroDoHorario(sp("2026-09-29T07:59"), 8, 21), false);
});

test("janela de 24 h do WhatsApp, com folga", () => {
  const ultima = sp("2026-09-29T10:00");
  assert.equal(dentroDaJanela(ultima, sp("2026-09-30T09:40")), true);
  assert.equal(dentroDaJanela(ultima, sp("2026-09-30T09:50")), false);
  assert.equal(dentroDaJanela(null, sp("2026-09-29T10:05")), false);
});

test("condições: parcela = total ÷ N; Pix = total × (1 − %)", () => {
  assert.deepEqual(condicoesPagamento(359.9, 5, 5), {
    total: 359.9,
    parcelas: 5,
    parcela: 71.98,
    descontoPixPercentual: 5,
    pix: 341.91,
  });
  assert.equal(condicoesPagamento(649.9 + 110, 5, 5).pix, 721.91);
});

test("validade com dia da semana (hoje em São Paulo + dias)", () => {
  // Terça, 29/09/2026 às 22h em SP (já é quarta em UTC).
  assert.deepEqual(validade(sp("2026-09-29T22:00"), 2), {
    data: "2026-10-01",
    texto: "quinta, 01/10",
  });
  assert.deepEqual(validade(sp("2026-10-03T10:00"), 2), {
    data: "2026-10-05",
    texto: "segunda, 05/10",
  });
});

test("data/hora local: lê e escreve em São Paulo", () => {
  assert.equal(
    lerDataHoraLocal("2026-10-02T14:30")?.toISOString(),
    sp("2026-10-02T14:30").toISOString(),
  );
  assert.equal(lerDataHoraLocal("2026-10-02")?.toISOString(), sp("2026-10-02T09:00").toISOString());
  assert.equal(lerDataHoraLocal("2026-02-30"), null);
  assert.equal(lerDataHoraLocal("amanhã"), null);
  assert.equal(dataHoraTexto(sp("2026-10-02T14:30")), "sexta, 02/10 às 14:30");
});

test("nomes da tabela comparados sem acento e sem diferença de caixa", () => {
  assert.equal(normalizarNome("Sofá comum  3 lugares"), normalizarNome("sofa COMUM 3 lugares"));
  assert.equal(
    normalizarNome("Sofá retrátil 2 módulos, até 2,50 m"),
    normalizarNome("sofa retratil 2 modulos, ate 2,50 m"),
  );
});

test("texto interno da IA (relatório) não vai ao cliente", () => {
  const relatorio = [
    'Enviei ao Breno a explicação da higienização numa mensagem só. Como ele não sabe a medida, ela já diz que vou considerar o sofá retrátil de 2 módulos com até 2,50 m e termina com "Ficou alguma dúvida, Breno?".',
    "- *Ficha do cliente:* atualizei o sofá (retrátil 2 módulos, cinza, medida não informada) e o resumo do atendimento. O próximo passo é o vídeo e o orçamento.\n- *Lembrete:* está marcado para hoje, 07:57. Se ele não responder até lá, eu sigo com o aviso e o vídeo da higienização.",
    "Usei atualizar_lead e agendar_followup.",
    "Lembrete: volto a falar com ela amanhã.",
    "O cliente não respondeu ainda.",
  ];
  for (const t of relatorio) assert.equal(textoInterno(t, "Breno"), true, t);
  const paraCliente = [
    "Prontinho, Breno! Te enviei a proposta ☺️\nEla faz sentido pro que você está buscando?",
    "Entendo, Breno! A melhor condição que temos é o Pix.\nQuanto você tinha planejado investir na higienização?",
    "Tranquilo, Breno! Pela foto, ele parece um sofá retrátil de 2 módulos.\nVocê sabe mais ou menos a medida dele?",
    "Enquanto eu preparo seu orçamento, vou te mandar um vídeo curtinho, tá bom?",
    "Se precisar remarcar, me avisa com 24 horas de antecedência, combinado? 💙",
    "Serviço agendado! ✅\n👨‍🔧 Técnico: Josué Barreto\nEstá tudo certinho, Breno?",
  ];
  for (const t of paraCliente) assert.equal(textoInterno(t, "Breno"), false, t);
});
