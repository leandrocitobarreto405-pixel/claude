import { test } from "node:test";
import assert from "node:assert/strict";
import { computeQuote, type QuoteInput } from "./quotes.server";
import { REGRAS_DESLIGADAS, type RegrasOrcamento } from "./orcamento-regras";

const params = { custoKm: 0, impostoPct: 0, custoFixoPorServico: 0, agora: "2026-10-08T12:00:00Z" };

const eco: RegrasOrcamento = {
  ...REGRAS_DESLIGADAS,
  descontoAdicional: { ligado: true, pct: 40, categorias: ["sofa", "colchao"] },
  minimoCadeiras: 90,
  sujidade: { ligado: true, pct: 10 },
  vitrine: { ligada: true, boasVindasPct: 20, pixPct: 10, arredondamento: "dezena_5" },
  parcelasMax: 5,
  validadeDias: 2,
};

function entrada(extra: Partial<QuoteInput> = {}): QuoteInput {
  return {
    cliente_nome: "Teste",
    cliente_telefone: null,
    cliente_cep: null,
    cliente_endereco: null,
    customer_id: null,
    data_servico: null,
    observacoes: null,
    desconto: 0,
    valor_a_vista: null,
    km_ida_volta: 0,
    custo_produtos: 0,
    custo_mao_obra: 0,
    forma_pagamento: null,
    parcelas: 1,
    taxa_percentual: 0,
    status: "rascunho",
    items: [
      {
        tabela_preco_item_id: null,
        nome_snapshot: "Sofá retrátil 2 lugares pequeno",
        tipo_servico: "higienizacao",
        preco_tabela: 220,
        preco_aplicado: 220,
        preco_sugerido: 220,
        motivo_desconto: null,
        quantidade: 1,
        categoria: "sofa",
        item_principal: true,
      },
      {
        tabela_preco_item_id: null,
        nome_snapshot: "Colchão casal",
        tipo_servico: "higienizacao",
        preco_tabela: 220,
        preco_aplicado: 132,
        preco_sugerido: 132,
        desconto_regra_valor: 88,
        desconto_regra_texto: "2º item: -40%",
        motivo_desconto: null,
        quantidade: 1,
        categoria: "colchao",
      },
    ],
    cliente_novo: true,
    ...extra,
  };
}

test("vitrine: total no cartão, à vista no Pix, nada marcado como editado", () => {
  const r = computeQuote(entrada(), { ...params, regras: eco, userId: "u1" });
  assert.equal(r.subtotal, 352);
  assert.equal(r.total, 390);
  assert.equal(r.regrasAplicadas.valor_vitrine, 490);
  assert.equal(r.regrasAplicadas.valor_pix, 355);
  assert.equal(r.regrasAplicadas.valores_editados_por, null);
  assert.ok(r.items.every((i) => i.editado_por === null && i.editado_em === null));
});

test("preço editado pela atendente guarda quem e quando; cartão editado vira o total", () => {
  const e = entrada({ valor_cartao_editado: 380 });
  e.items[1] = { ...e.items[1]!, preco_aplicado: 120 };
  const r = computeQuote(e, { ...params, regras: eco, userId: "u1" });
  assert.equal(r.items[1]!.editado_por, "u1");
  assert.equal(r.items[1]!.editado_em, "2026-10-08T12:00:00Z");
  assert.equal(r.items[1]!.preco_tabela, 220);
  assert.equal(r.items[0]!.editado_por, null);
  assert.equal(r.total, 380);
  assert.equal(r.regrasAplicadas.valores_editados_por, "u1");
});

test("sem regras (Turbine, Alice): total = subtotal − desconto, como antes", () => {
  const e = entrada({ desconto: 10, cliente_novo: null });
  const r = computeQuote(e, params);
  assert.equal(r.total, 342);
  assert.equal(r.regrasAplicadas.valor_cartao, null);
  assert.equal(r.regrasAplicadas.acrescimo_sujidade, 0);
});

test("muito sujo soma 10% antes da vitrine", () => {
  const r = computeQuote(entrada({ muito_sujo: true }), { ...params, regras: eco });
  assert.equal(r.regrasAplicadas.acrescimo_sujidade, 35.2);
  assert.equal(r.regrasAplicadas.muito_sujo, true);
});

const turbine: RegrasOrcamento = {
  ...REGRAS_DESLIGADAS,
  classe: { ligada: true, aPct: 20 },
  acrescimos: { ligado: true, almofadasPct: 10, encardidoPct: 10 },
};

function sofaTurbine(extra: Partial<QuoteInput["items"][number]> = {}): QuoteInput {
  return entrada({
    cliente_novo: null,
    items: [
      {
        tabela_preco_item_id: null,
        nome_snapshot: "Sofá comum 3 lugares",
        tipo_servico: "higienizacao",
        preco_tabela: 260,
        preco_sugerido: 312,
        preco_aplicado: 312,
        motivo_desconto: null,
        quantidade: 1,
        categoria: "sofa",
        classe: "A",
        ...extra,
      },
    ],
  });
}

test("classe/acréscimos: o servidor refaz o % pelas regras e guarda as marcações", () => {
  const r = computeQuote(sofaTurbine({ almofadas_soltas: true }), { ...params, regras: turbine });
  const it = r.items[0]!;
  assert.equal(it.classe, "A");
  assert.equal(it.almofadas_soltas, true);
  assert.equal(it.acrescimo_pct, 30);
  // Preço calculado pela regra (sugerido) não conta como edição.
  assert.equal(it.editado_por, null);
});

test("empresa sem classe/acréscimos: marcações ignoradas", () => {
  const r = computeQuote(sofaTurbine({ almofadas_soltas: true, muito_encardido: true }), {
    ...params,
    regras: REGRAS_DESLIGADAS,
  });
  const it = r.items[0]!;
  assert.deepEqual(
    [it.classe, it.almofadas_soltas, it.muito_encardido, it.acrescimo_pct],
    [null, false, false, 0],
  );
});

test("preço final editado por pessoa: guarda calculado, final e quem editou", () => {
  const r = computeQuote(sofaTurbine({ preco_aplicado: 300 }), {
    ...params,
    regras: turbine,
    userId: "maria",
  });
  const it = r.items[0]!;
  assert.deepEqual([it.preco_sugerido, it.preco_aplicado, it.editado_por], [312, 300, "maria"]);
});

test("desconto: campanha pelo % (nunca valor livre) e manual pelo valor", () => {
  const camp = computeQuote(
    { ...sofaTurbine(), desconto_tipo: "campanha", desconto_pct: 15, desconto: 999 },
    { ...params, regras: turbine },
  );
  assert.equal(camp.desconto, 46.8); // 15% de 312
  assert.equal(camp.total, 265.2);
  assert.equal(camp.regrasAplicadas.desconto_tipo, "campanha");
  const manual = computeQuote(
    { ...sofaTurbine(), desconto_tipo: "manual", desconto: 12 },
    { ...params, regras: turbine },
  );
  assert.equal(manual.desconto, 12);
  assert.equal(manual.regrasAplicadas.desconto_pct, null);
  const sem = computeQuote(sofaTurbine(), { ...params, regras: turbine });
  assert.equal(sem.regrasAplicadas.desconto_tipo, null);
});
