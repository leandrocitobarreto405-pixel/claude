// Caixa de entrada: janela de 24 h, texto, quem responde, situação e modelos. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  janelaDeResposta,
  modelosParaResponder,
  podeResponder,
  primeiroNomeDoContato,
  situacaoParaResponder,
  validarTexto,
} from "./caixa";
import type { ModeloMeta } from "./mkt/modelos";

test("janela de 24 h conta da última mensagem do cliente, com folga de 15 min", () => {
  const agora = new Date("2026-10-20T12:00:00Z");
  assert.deepEqual(janelaDeResposta(null, agora), {
    aberta: false,
    motivo: "sem_mensagem_do_cliente",
  });
  const aberta = janelaDeResposta("2026-10-19T13:00:00Z", agora);
  assert.ok(aberta.aberta && aberta.fechaEm === "2026-10-20T13:00:00.000Z");
  // Faltando só 10 min, já conta como fechada (folga).
  assert.equal(janelaDeResposta("2026-10-19T12:10:00Z", agora).aberta, false);
  assert.deepEqual(janelaDeResposta("2026-10-18T12:00:00Z", agora), {
    aberta: false,
    motivo: "passou_24h",
  });
});

test("texto: obrigatório, até 4096, quebras de linha normalizadas", () => {
  assert.throws(() => validarTexto("   "), /Escreva/);
  assert.throws(() => validarTexto("a".repeat(4097)), /longa/);
  assert.equal(validarTexto("  oi\r\ntudo bem?  "), "oi\ntudo bem?");
});

test("quem responde e quando", () => {
  assert.ok(podeResponder("admin"));
  assert.ok(podeResponder("atendente"));
  assert.ok(!podeResponder("tecnico"));
  assert.ok(!podeResponder(null));
  assert.deepEqual(situacaoParaResponder("pending"), { pode: false, motivo: "com_a_alice" });
  assert.deepEqual(situacaoParaResponder("open"), { pode: true, reabre: false });
  assert.deepEqual(situacaoParaResponder("resolved"), { pode: true, reabre: true });
});

test("modelos fora da janela: só aprovados que se preenchem com o nome", () => {
  const modelos: ModeloMeta[] = [
    {
      name: "retomar_contato",
      language: "pt_BR",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Oi {{1}}, posso te ajudar com o orçamento?" }],
    },
    {
      name: "retomar_contato_sn",
      language: "pt_BR",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Olá! Posso te ajudar com o orçamento?" }],
    },
    {
      name: "promo_outubro",
      language: "pt_BR",
      status: "APPROVED",
      components: [{ type: "BODY", text: "{{1}}, {{2}}" }],
    },
    {
      name: "em_analise",
      language: "pt_BR",
      status: "PENDING",
      components: [{ type: "BODY", text: "Olá!" }],
    },
  ];
  const comNome = modelosParaResponder(modelos, "Ana");
  assert.deepEqual(
    comNome.map((m) => m.nome),
    ["retomar_contato", "retomar_contato_sn"],
  );
  assert.equal(comNome[0]!.texto, "Oi Ana, posso te ajudar com o orçamento?");
  assert.deepEqual(comNome[0]!.parametros, { "1": "Ana" });
  // Sem nome confiável, só a variante sem nome.
  assert.deepEqual(
    modelosParaResponder(modelos, null).map((m) => m.nome),
    ["retomar_contato_sn"],
  );
});

test("primeiro nome do contato: limpo ou null", () => {
  assert.equal(primeiroNomeDoContato("ana paula 🌸"), "Ana");
  assert.equal(primeiroNomeDoContato("11 99999-0000"), null);
  assert.equal(primeiroNomeDoContato(null), null);
});
