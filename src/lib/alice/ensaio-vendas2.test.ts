// Conferência do ensaio das fases 3 e 4 (pura, dados fictícios).
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirConversa2 } from "./ensaio-vendas2.server";

test("retomada: passa só com o texto aprovado, exatamente", () => {
  const esperado = "Oi, Marcos, bom dia! Conseguiu analisar o orçamento?";
  const turno = (alice: string) => [
    {
      cliente: "[sistema] retomada",
      sistema: "retomada" as const,
      alice: [alice],
      ferramentas: [],
      esperado,
    },
  ];
  assert.equal(conferirConversa2("retomada", turno(esperado)).passou, true);
  assert.deepEqual(conferirConversa2("retomada", turno(`${esperado} 😊`)).problemas, [
    "o toque não saiu exatamente com o texto aprovado",
  ]);
});

test("retorno às 11h: hora marcada, retorno agendado, retomada barrada e retomada no horário", () => {
  const turnos = [
    {
      cliente: "Vou ver com meu marido e te falo",
      alice: [
        "Tudo bem, Camila! Posso te chamar amanhã às 11h pra gente ver isso? Seu orçamento fica garantido até sábado.",
      ],
      ferramentas: [
        { nome: "agendar_followup", entrada: '{"trilha":"C","data_hora":"2026-11-14 11:00"}' },
      ],
    },
    {
      cliente: "[sistema] 8h",
      sistema: "barrada" as const,
      alice: ["(não saiu: o cliente tem retorno combinado às 14/11 11:00)"],
      ferramentas: [],
    },
    {
      cliente: "[sistema] retorno",
      sistema: "retorno_c" as const,
      alice: ["E aí, Camila, conseguiu conversar com o seu marido? O que ele achou?"],
      ferramentas: [],
    },
  ];
  assert.deepEqual(conferirConversa2("retorno_11h", turnos), { passou: true, problemas: [] });
});

test("combo com cupom: cartão sem Pix, Pix com 3% a mais quando pedem e desconto vai para a Maria", () => {
  const turnos = [
    {
      cliente: "Pode mandar",
      alice: ["Total com desconto: R$ 652,00"],
      ferramentas: [{ nome: "criar_orcamento", entrada: '{"combo":true,"cupom":"BLOG50"}' }],
    },
    {
      cliente: "E no Pix, tem desconto?",
      alice: ["No Pix tem um desconto a mais: fica R$ 632,44 💙"],
      ferramentas: [],
    },
    {
      cliente: "E não dá pra fazer mais barato?",
      alice: ["Vou chamar a Maria"],
      ferramentas: [{ nome: "transferir_para_humano", entrada: "{}" }],
    },
  ];
  assert.deepEqual(conferirConversa2("combo_cupom", turnos, 632.44), {
    passou: true,
    problemas: [],
  });
});
