// Cupons da tela (Configurações › Vendas › Cupons) e do orçamento manual. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarCupom,
  limparCodigo,
  validarCupom,
  type CupomDoOrcamento,
  type CupomTela,
} from "./cupons";

const base: CupomTela = {
  id: null,
  codigo: "site 50",
  tipo: "valor",
  quantia: 50,
  servico: "higienizacao",
  origemId: "",
  validoAte: "",
  ativo: true,
};

test("código só com letras e números, em maiúsculas", () => {
  assert.equal(limparCodigo(" site-50 "), "SITE50");
  assert.equal(limparCodigo("verão10"), "VERAO10");
});

test("valida e monta a linha: reais OU percentual, vazio vira null", () => {
  assert.deepEqual(validarCupom(base), {
    codigo: "SITE50",
    valor: 50,
    percentual: null,
    servico: "higienizacao",
    origem_id: null,
    valido_ate: null,
    ativo: true,
  });
  const pct = validarCupom({ ...base, tipo: "percentual", quantia: 10, validoAte: "2026-12-31" });
  assert.equal(pct.valor, null);
  assert.equal(pct.percentual, 10);
  assert.equal(pct.valido_ate, "2026-12-31");
  assert.throws(() => validarCupom({ ...base, codigo: "ab" }), /3 a 30/);
  assert.throws(() => validarCupom({ ...base, quantia: 0 }), /desconto/);
  assert.throws(() => validarCupom({ ...base, tipo: "percentual", quantia: 120 }), /100%/);
  assert.throws(() => validarCupom({ ...base, validoAte: "31/12/2026" }), /validade/);
});

const CUPONS: CupomDoOrcamento[] = [
  { codigo: "SITE50", valor: 50, percentual: null, servico: "higienizacao", validoAte: null },
  {
    codigo: "IMPER10",
    valor: null,
    percentual: 10,
    servico: "impermeabilizacao",
    validoAte: "2026-10-31",
  },
];
const hoje = "2026-10-26";

test("orçamento manual: desconto no serviço do cupom", () => {
  const r = aplicarCupom("site50", CUPONS, { higienizacao: 260, impermeabilizacao: 0 }, hoje);
  assert.ok(r.ok);
  assert.equal(r.desconto, 50);
  const p = aplicarCupom("IMPER10", CUPONS, { higienizacao: 260, impermeabilizacao: 520 }, hoje);
  assert.ok(p.ok);
  assert.equal(p.desconto, 52, "10% só sobre a impermeabilização");
});

test("orçamento manual: cupom que não vale diz o motivo", () => {
  const nao = (c: string, b = { higienizacao: 260, impermeabilizacao: 0 }, h = hoje) => {
    const r = aplicarCupom(c, CUPONS, b, h);
    assert.ok(!r.ok);
    return r.motivo;
  };
  assert.match(nao("NAOEXISTE"), /não existe/);
  assert.match(nao("IMPER10"), /impermeabilização/);
  assert.match(nao("IMPER10", { higienizacao: 0, impermeabilizacao: 520 }, "2026-11-01"), /venceu/);
});
