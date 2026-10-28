import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REGRAS_DESLIGADAS,
  calcularTotais,
  calcularVitrine,
  regrasDaLinha,
  sugerirPrecos,
  type LinhaRegra,
} from "./orcamento-regras";

const eco = regrasDaLinha({
  desconto_adicional_ligado: true,
  desconto_adicional_pct: 40,
  desconto_categorias: ["sofa", "colchao"],
  minimo_cadeiras: 90,
  sujidade_ligado: true,
  sujidade_pct: 10,
  distancia_ligado: true,
  distancia_sem_acrescimo_km: 15,
  distancia_limite_km: 30,
  distancia_pct: 10,
  vitrine_ligada: true,
  boas_vindas_pct: 20,
  pix_pct: 10,
  arredondamento: "dezena_5",
  parcelas_max: 5,
  validade_dias: 2,
});
const sofa: LinhaRegra = { key: "sofa", categoria: "sofa", precoTabela: 220, quantidade: 1 };
const colchao: LinhaRegra = {
  key: "colchao",
  categoria: "colchao",
  precoTabela: 220,
  quantidade: 1,
};

test("exemplo do pedido: sofá 220 + colchão casal 220 com 40% = 352 no Pix", () => {
  const s = sugerirPrecos([sofa, colchao], eco);
  assert.equal(s.get("sofa")!.precoSugerido, 220);
  assert.equal(s.get("sofa")!.principal, true);
  assert.equal(s.get("colchao")!.precoSugerido, 132);
  assert.equal(s.get("colchao")!.descontoTexto, "2º item: -40%");
  const t = calcularTotais({
    linhas: [
      { categoria: "sofa", precoAplicado: 220, quantidade: 1 },
      { categoria: "colchao", precoAplicado: 132, quantidade: 1 },
    ],
    regras: eco,
    muitoSujo: false,
    distanciaKm: 8,
    desconto: 0,
    clienteNovo: true,
  });
  assert.equal(t.base, 352);
  assert.deepEqual(t.vitrine, { vitrine: 490, cartao: 390, pix: 355, boasVindas: true });
});

test("vitrine do exemplo: Pix 220 → 310 → cartão 250 → Pix 225; cliente antigo paga 310 / 280", () => {
  assert.deepEqual(calcularVitrine(220, eco.vitrine, true), {
    vitrine: 310,
    cartao: 250,
    pix: 225,
    boasVindas: true,
  });
  assert.deepEqual(calcularVitrine(220, eco.vitrine, false), {
    vitrine: 310,
    cartao: 310,
    pix: 280,
    boasVindas: false,
  });
  // Pix nunca abaixo da tabela, em toda a tabela da Ecoprime.
  for (const base of [100, 150, 220, 230, 240, 250, 260, 300, 350, 400, 352, 90]) {
    const v = calcularVitrine(base, eco.vitrine, true);
    assert.ok(v.pix >= base, `pix ${v.pix} >= ${base}`);
    assert.equal(v.vitrine % 10, 0);
    assert.equal(v.cartao % 5, 0);
    assert.equal(v.pix % 5, 0);
  }
});

test("dois itens iguais: o segundo também ganha 40%; cadeiras ficam fora do automático", () => {
  const s = sugerirPrecos(
    [
      { key: "c", categoria: "colchao", precoTabela: 220, quantidade: 2 },
      { key: "cad", categoria: "cadeira", precoTabela: 40, quantidade: 4 },
    ],
    eco,
  );
  assert.equal(s.get("c")!.descontoValor, 88);
  assert.equal(s.get("c")!.precoSugerido, 176);
  assert.equal(s.get("c")!.descontoTexto, "2º item: -40%");
  assert.equal(s.get("cad")!.precoSugerido, 40);
  assert.equal(s.get("cad")!.descontoTexto, null);
});

test("atendente troca o desconto: sofá cheio e cadeiras com 40%", () => {
  const s = sugerirPrecos(
    [
      { key: "cad", categoria: "cadeira", precoTabela: 40, quantidade: 2, desconto: "sim" },
      { ...sofa, key: "s2" },
    ],
    eco,
  );
  assert.equal(s.get("s2")!.principal, true);
  assert.equal(s.get("cad")!.precoSugerido, 24);
  assert.equal(s.get("cad")!.descontoTexto, "2º e 3º itens: -40%");
  // E escolhendo outro principal: o colchão fica cheio e o sofá ganha o desconto.
  const t = sugerirPrecos([{ ...sofa, precoTabela: 300 }, colchao], eco, "colchao");
  assert.equal(t.get("colchao")!.precoSugerido, 220);
  assert.equal(t.get("sofa")!.precoSugerido, 180);
});

test("pedido só de cadeiras: mínimo de R$ 90", () => {
  const t = calcularTotais({
    linhas: [{ categoria: "cadeira", precoAplicado: 40, quantidade: 1 }],
    regras: eco,
    muitoSujo: false,
    distanciaKm: null,
    desconto: 0,
    clienteNovo: true,
  });
  assert.equal(t.minimoAplicado, 50);
  assert.equal(t.base, 90);
});

test("muito sujo e distância: +10% cada sobre o pedido; acima do limite avisa fora da área", () => {
  const linhas = [{ categoria: "sofa" as const, precoAplicado: 300, quantidade: 1 }];
  const base = { linhas, regras: eco, desconto: 0, clienteNovo: true };
  assert.equal(calcularTotais({ ...base, muitoSujo: true, distanciaKm: 5 }).base, 330);
  const longe = calcularTotais({ ...base, muitoSujo: true, distanciaKm: 20 });
  assert.equal(longe.base, 360);
  assert.equal(longe.foraDaArea, false);
  const fora = calcularTotais({ ...base, muitoSujo: false, distanciaKm: 40 });
  assert.equal(fora.foraDaArea, true);
  assert.equal(fora.acrescimoDistancia, 30);
});

test("regras desligadas: orçamento como antes (Turbine)", () => {
  const s = sugerirPrecos([sofa, colchao], REGRAS_DESLIGADAS);
  assert.equal(s.get("colchao")!.precoSugerido, 220);
  const t = calcularTotais({
    linhas: [{ categoria: "sofa", precoAplicado: 359.9, quantidade: 1 }],
    regras: REGRAS_DESLIGADAS,
    muitoSujo: true,
    distanciaKm: 99,
    desconto: 20,
    clienteNovo: true,
  });
  assert.equal(t.base, 339.9);
  assert.equal(t.vitrine, null);
  assert.equal(regrasDaLinha(null), REGRAS_DESLIGADAS);
});

test("arredondamento ,90", () => {
  const v = calcularVitrine(220, { ...eco.vitrine, arredondamento: "noventa" }, true);
  assert.equal(v.vitrine, 309.9);
  assert.ok(
    Math.abs(((v.cartao * 100) % 500) - 490) < 1e-6,
    `cartão termina em 4,90 ou 9,90: ${v.cartao}`,
  );
  assert.ok(v.pix >= 220);
});

test("tapete e persiana ficam fora do desconto do item adicional (nem à mão)", () => {
  const regras = regrasDaLinha({
    desconto_adicional_ligado: true,
    desconto_adicional_pct: 40,
    desconto_categorias: ["sofa", "colchao", "tapete", "persiana"],
  });
  assert.deepEqual(regras.descontoAdicional.categorias, ["sofa", "colchao"]);
  const s = sugerirPrecos(
    [
      { key: "sofa", categoria: "sofa", precoTabela: 300, quantidade: 1 },
      { key: "tap", categoria: "tapete", precoTabela: 62.4, quantidade: 3.68 },
      { key: "per", categoria: "persiana", precoTabela: 150, quantidade: 2, desconto: "sim" },
      { key: "col", categoria: "colchao", precoTabela: 250, quantidade: 1 },
    ],
    regras,
  );
  assert.equal(s.get("tap")!.descontoValor, 0);
  assert.equal(s.get("per")!.descontoValor, 0);
  assert.equal(s.get("per")!.precoSugerido, 150);
  // O colchão continua sendo o 2º item (tapete e persiana não contam na ordem).
  assert.equal(s.get("col")!.descontoTexto, "2º item: -40%");
});

test("tapete por m²: 3,68 m² x R$ 62,40 = R$ 229,63 no total", () => {
  const t = calcularTotais({
    linhas: [{ categoria: "tapete", precoAplicado: 62.4, quantidade: 3.68 }],
    regras: REGRAS_DESLIGADAS,
    muitoSujo: false,
    distanciaKm: null,
    desconto: 0,
    clienteNovo: false,
  });
  assert.equal(t.subtotalItens, 229.63);
});

// Turbine (22/10/2026): até 20 km sem taxa; 20–35 km pela faixa de valor; acima de 35 fora da área.
const turbine = regrasDaLinha({
  distancia_ligado: true,
  distancia_sem_acrescimo_km: 20,
  distancia_limite_km: 35,
  distancia_pct: 10,
  distancia_faixas: [
    { ate: 1000, pct: 10 },
    { ate: null, pct: 0 },
    { ate: 500, pct: 20 },
  ],
});

test("taxa de deslocamento por faixa de valor", () => {
  const um = (preco: number, km: number | null, extra: object = {}) =>
    calcularTotais({
      linhas: [{ categoria: "sofa", precoAplicado: preco, quantidade: 1 }],
      regras: turbine,
      muitoSujo: false,
      distanciaKm: km,
      desconto: 0,
      clienteNovo: true,
      ...extra,
    });
  assert.equal(um(249.9, 15).acrescimoDistancia, 0);
  assert.equal(um(249.9, 20).acrescimoDistancia, 0);
  assert.equal(um(249.9, 30).acrescimoDistancia, 49.98);
  assert.equal(um(249.9, 30).distanciaPct, 20);
  assert.equal(um(500, 30).distanciaPct, 20);
  assert.equal(um(700, 30).acrescimoDistancia, 70);
  assert.equal(um(1000, 30).distanciaPct, 10);
  assert.equal(um(1200, 30).acrescimoDistancia, 0);
  assert.equal(um(700, 35).foraDaArea, false);
  assert.equal(um(700, 38).foraDaArea, true);
  // A equipe altera ou tira: a regra fica guardada para comparar.
  const tirada = um(700, 30, { taxaDistancia: 0 });
  assert.equal(tirada.acrescimoDistancia, 0);
  assert.equal(tirada.acrescimoDistanciaRegra, 70);
  assert.equal(tirada.base, 700);
  assert.equal(um(700, 30, { taxaDistancia: 50 }).base, 750);
  // Desconto de campanha (10%) só nos itens, não na taxa.
  const comDesconto = um(700, 30, { descontoPct: 10 });
  assert.equal(comDesconto.desconto, 70);
  assert.equal(comDesconto.base, 700);
});

test("sem arredondamento: vitrine e Pix só nos centavos, Pix nunca abaixo da tabela", () => {
  const regras = { ligada: true, boasVindasPct: 20, pixPct: 5, arredondamento: "nenhum" as const };
  const v = calcularVitrine(220, regras, true);
  // 220 / (0,8 × 0,95) = 289,47… → 289,48 (para cima, centavos)
  assert.equal(v.vitrine, 289.48);
  assert.equal(v.cartao, 231.58);
  assert.ok(v.pix >= 220);
  assert.equal(calcularVitrine(220, regras, false).cartao, 289.48);
});
