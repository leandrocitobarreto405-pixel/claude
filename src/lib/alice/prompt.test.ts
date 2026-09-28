import { test } from "node:test";
import assert from "node:assert/strict";
import {
  custoEstimadoUsd,
  dividirResposta,
  instrucoesFixas,
  montarTurnos,
  type MensagemHistorico,
} from "./prompt";

const m = (
  direcao: "Recebida" | "Enviada",
  texto: string,
  extra: Partial<MensagemHistorico> = {},
) =>
  ({
    direcao,
    texto,
    tipo: "Texto",
    remetente: direcao === "Recebida" ? "contact" : "agent_bot",
    imagens: [],
    ...extra,
  }) as MensagemHistorico;

test("turnos alternam cliente/empresa e juntam mensagens seguidas", () => {
  const t = montarTurnos([
    m("Recebida", "Oi"),
    m("Recebida", "quero orçamento"),
    m("Enviada", "Olá!"),
    m("Recebida", "sofá 3 lugares"),
  ]);
  assert.ok(t);
  assert.deepEqual(
    t.map((x) => x.role),
    ["user", "assistant", "user"],
  );
  assert.equal((t[0]!.content as Array<{ text: string }>).length, 2);
});

test("começa pelo cliente e só responde se a última for do cliente", () => {
  assert.equal(montarTurnos([m("Recebida", "Oi"), m("Enviada", "Olá!")]), null);
  const t = montarTurnos([m("Enviada", "Mensagem de boas-vindas"), m("Recebida", "Oi")]);
  assert.equal(t?.length, 1);
  assert.equal(t?.[0]!.role, "user");
});

test("foto vira imagem; áudio e atendente humano ficam marcados", () => {
  const t = montarTurnos([
    m("Recebida", "", { tipo: "Imagem", imagens: [{ mediaType: "image/jpeg", base64: "AAAA" }] }),
    m("Enviada", "Oi, sou a Carol", { remetente: "user" }),
    m("Recebida", "", { tipo: "Áudio" }),
  ]);
  assert.ok(t);
  const blocos = t[0]!.content as Array<{ type: string }>;
  assert.equal(blocos[0]!.type, "image");
  assert.match(JSON.stringify(t[1]), /\[atendente da equipe\] Oi, sou a Carol/);
  assert.match(JSON.stringify(t[2]), /enviou um áudio/);
});

test("resposta vira mensagens de WhatsApp, com negrito do WhatsApp e limite", () => {
  assert.deepEqual(dividirResposta("Oi! **Tudo bem?**\n\nO sofá sai por *R$ 180*."), [
    "Oi! *Tudo bem?*",
    "O sofá sai por *R$ 180*.",
  ]);
  assert.equal(dividirResposta("a\n\nb\n\nc\n\nd\n\ne\n\nf").length, 4);
});

test("custo: cache lido a 10% e gravado a 125%", () => {
  const c = custoEstimadoUsd("claude-opus-5", {
    entrada: 1_000_000,
    saida: 100_000,
    cacheLeitura: 1_000_000,
    cacheEscrita: 0,
  });
  assert.equal(c, 5 + 2.5 + 0.5);
  assert.equal(
    custoEstimadoUsd("claude-sonnet-5", {
      entrada: 0,
      saida: 1_000_000,
      cacheLeitura: 0,
      cacheEscrita: 1_000_000,
    }),
    10 + 2.5,
  );
});

test("instruções trazem nome, preços, desconto e regras da empresa", () => {
  const txt = instrucoesFixas({
    empresa: "Turbine Clean",
    telefone: null,
    instagram: null,
    nomeAssistente: "Alice",
    instrucoes: "Atendemos só Florianópolis.",
    perguntasFrequentes: "",
    descontoMaxPercentual: 0,
    precos: [{ nome: "Sofá 3 lugares", higienizacao: 180, impermeabilizacao: 250 }],
    formasPagamento: ["Pix", "Crédito em até 6x"],
    servicos: ["Higienização"],
  });
  assert.match(txt, /Sou a Alice, assistente virtual da Turbine Clean/);
  assert.match(txt, /Sofá 3 lugares: higienização R\$\s?180,00 · impermeabilização R\$\s?250,00/);
  assert.match(txt, /você não pode oferecer desconto/);
  assert.match(txt, /Atendemos só Florianópolis\./);
  assert.match(txt, /Crédito em até 6x/);
});
