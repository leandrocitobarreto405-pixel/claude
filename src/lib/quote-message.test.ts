import { test } from "node:test";
import assert from "node:assert/strict";
import { textoOuPadrao } from "./modelos-mensagem";
import { regrasDaLinha } from "./orcamento-regras";
import { quoteWhatsappMessage as montar } from "./quote-message";

/** O real formatado usa espaço que não quebra ("R$ 1,00"); no teste, espaço comum. */
const quoteWhatsappMessage = (...a: Parameters<typeof montar>) =>
  montar(...a).replace(/\u00a0/g, " ");

const ecoTextos: Record<string, string> = {
  orcamento_higienizacao:
    "*Higienização de Estofados {empresa}*\n\nLimpeza profunda com extração, que remove poeira, ácaros, manchas e odores do seu estofado.\n\n✅ Equipamento profissional de extração\n✅ Atendimento no dia e horário combinados",
};
const regras = regrasDaLinha({
  desconto_adicional_ligado: true,
  sujidade_ligado: true,
  sujidade_pct: 10,
  vitrine_ligada: true,
  boas_vindas_pct: 20,
  pix_pct: 10,
});
const t = {
  empresa: "Ecoprime",
  parcelasMax: 5,
  validadeDias: 2,
  texto: (c: string) => textoOuPadrao(c, ecoTextos) ?? "",
  regras,
};
const itens = [
  {
    quantidade: 1,
    nome_snapshot: "Sofá retrátil 2 lugares pequeno",
    tipo_servico: "higienizacao" as const,
    subtotal: 220,
    desconto_regra_texto: null,
  },
  {
    quantidade: 1,
    nome_snapshot: "Colchão casal",
    tipo_servico: "higienizacao" as const,
    subtotal: 132,
    desconto_regra_texto: "2º item: -40%",
  },
];

test("mensagem da Ecoprime com vitrine e boas-vindas", () => {
  const m = quoteWhatsappMessage(
    {
      cliente_nome: "Carla",
      subtotal: 352,
      desconto: 0,
      total: 390,
      valor_a_vista: 355,
      cliente_novo: true,
      valor_vitrine: 490,
      valor_cartao: 390,
      valor_pix: 355,
      acrescimo_sujidade: 0,
      acrescimo_distancia: 0,
      minimo_aplicado: 0,
    },
    itens,
    t,
  );
  assert.equal(
    m,
    [
      "Olá, Carla! Tudo bem?",
      "",
      "*Higienização de Estofados Ecoprime*",
      "",
      "Limpeza profunda com extração, que remove poeira, ácaros, manchas e odores do seu estofado.",
      "",
      "✅ Equipamento profissional de extração",
      "✅ Atendimento no dia e horário combinados",
      "",
      "*Estofados:*",
      "• 1x Sofá retrátil 2 lugares pequeno",
      "• 1x Colchão casal (2º item: -40%)",
      "",
      "Valor dos estofados: R$ 490,00",
      "🎁 Boas-vindas (cliente novo): -20% → *R$ 390,00* no cartão, em até 5x de R$ 78,00",
      "💸 *No Pix: R$ 355,00*",
      "",
      "_Orçamento válido por 2 dias._",
    ].join("\n"),
  );
});

test("cliente antigo e muito sujo: sem boas-vindas, adicional em texto", () => {
  const m = quoteWhatsappMessage(
    {
      cliente_nome: "Ana",
      subtotal: 220,
      desconto: 0,
      total: 340,
      valor_a_vista: 310,
      cliente_novo: false,
      valor_vitrine: 340,
      valor_cartao: 340,
      valor_pix: 310,
      acrescimo_sujidade: 22,
    },
    [itens[0]!],
    t,
  );
  assert.ok(m.includes("➕ Sujeira intensa: +10%"));
  assert.ok(m.includes("Valor dos estofados: *R$ 340,00* no cartão, em até 5x de R$ 68,00"));
  assert.ok(m.includes("💸 *No Pix: R$ 310,00*"));
  assert.ok(!m.includes("Boas-vindas"));
});

function semRegras<T extends { regras?: unknown }>(o: T): Omit<T, "regras"> {
  const { regras: _r, ...resto } = o;
  return resto;
}

test("sem vitrine (Turbine): mensagem como antes, com preço por item", () => {
  const m = quoteWhatsappMessage(
    { cliente_nome: "Rui", subtotal: 359.9, desconto: 0, total: 359.9, valor_a_vista: 341.9 },
    [{ ...itens[0]!, subtotal: 359.9 }],
    { ...semRegras(t), texto: (c: string) => textoOuPadrao(c, {}) ?? "" },
  );
  assert.ok(m.includes("• 1x Sofá retrátil 2 lugares pequeno — Higienização: R$ 359,90"));
  assert.ok(m.includes("*Total: 5x de R$ 71,98 sem juros ou à vista por R$ 341,90*"));
});
