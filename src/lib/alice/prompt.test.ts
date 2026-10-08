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
  assert.equal(dividirResposta("a\n\nb\n\nc\n\nd\n\ne\n\nf").length, 3);
  assert.deepEqual(dividirResposta("Entendi, Ana!\nQual o seu CEP?"), [
    "Entendi, Ana!\nQual o seu CEP?",
  ]);
});

test("custo: preço de cada modelo; cache gravado a 125%", () => {
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
  // Opus 5.5: US$ 4 / 20; cache lido a US$ 0,20.
  assert.equal(
    custoEstimadoUsd("claude-opus-5-5", {
      entrada: 1_000_000,
      saida: 1_000_000,
      cacheLeitura: 1_000_000,
      cacheEscrita: 1_000_000,
    }),
    4 + 20 + 0.2 + 5,
  );
});

const empresa = {
  empresa: "Turbine Clean",
  telefone: null,
  instagram: null,
  nomeAssistente: "Alice",
  descricaoNegocio: "empresa de higienização e impermeabilização de estofados",
  instrucoes: "",
  perguntasFrequentes: "",
  precos: [
    { nome: "Sofá 3 lugares", higienizacao: 180, impermeabilizacao: 250 },
    { nome: "Colchão casal", higienizacao: 249.9, impermeabilizacao: null },
  ],
  servicos: ["Higienização"],
  equipe: ["Maria", "Carol"],
  descontoPixPercentual: 5,
  parcelasMax: 5,
  validadeDias: 2,
  horaInicio: 8,
  horaFim: 21,
  ferramentas: ["atualizar_lead", "criar_orcamento", "transferir_para_humano"],
};

test("sem instruções próprias: roteiro padrão com apresentação e tabela", () => {
  const txt = instrucoesFixas(empresa);
  assert.match(txt, /Sou a Alice, assistente virtual da Turbine Clean/);
  assert.match(txt, /Sofá 3 lugares: higienização R\$\s?180,00 · impermeabilização R\$\s?250,00/);
  assert.match(txt, /Colchão casal: higienização R\$\s?249,90$/m);
  assert.match(txt, /Pix com 5% de desconto; cartão em até 5x sem juros/);
  assert.match(txt, /Equipe de vendas: Maria, Carol/);
  assert.match(
    txt,
    /Ferramentas liberadas agora: atualizar_lead, criar_orcamento, transferir_para_humano\./,
  );
  assert.match(txt, /das 8h às 21h/);
});

test("com instruções da empresa: elas substituem o roteiro padrão", () => {
  const txt = instrucoesFixas({
    ...empresa,
    instrucoes: "# PROMPT DA ALICE\nToda mensagem termina com uma pergunta.",
  });
  assert.match(txt, /Toda mensagem termina com uma pergunta\./);
  assert.doesNotMatch(txt, /Na primeira resposta, apresente-se/);
  // Regras técnicas continuam valendo.
  assert.match(txt, /TODO texto que você escreve fora das ferramentas vai direto para o cliente/);
  assert.match(txt, /vai pela ferramenta enviar_mensagem/);
});

test("follow-up: aviso do sistema entra como último turno do cliente", () => {
  const t = montarTurnos(
    [m("Recebida", "Oi"), m("Enviada", "Segue o orçamento")],
    "Hora do follow-up.",
  );
  assert.ok(t);
  assert.equal(t.length, 3);
  assert.equal(t[2]!.role, "user");
  assert.match(JSON.stringify(t[2]), /\[sistema\] Hora do follow-up\./);
});

test("áudio do cliente com transcrição vai como texto", () => {
  const t = montarTurnos([
    m("Recebida", "", { tipo: "Áudio", transcricao: "quero limpar meu sofá" }),
  ]);
  assert.match(JSON.stringify(t), /transcrição automática\] quero limpar meu sofá/);
});

test("garantia: regra só para empresa com termo de garantia configurado", () => {
  assert.doesNotMatch(instrucoesFixas(empresa), /garantia – manutenção/);
  const txt = instrucoesFixas({ ...empresa, garantiaImpermeabilizacao: true });
  assert.match(txt, /fluido corporal de pet ou pessoa/);
  assert.match(txt, /líquido denso/);
  assert.match(txt, /visita técnica gratuita de avaliação/);
  assert.match(txt, /transferir_para_humano, motivo "garantia – manutenção"/);
});
