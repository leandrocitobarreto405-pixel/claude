import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chaveDaLista,
  entradaDaAcao,
  limiteDeDesconto,
  montarAcao,
  opcoesDeContagem,
  proximaDataDisparo,
  rotuloDaLista,
  taxasHistoricas,
  textoPushPlano,
  type AcaoIA,
} from "./plano";

describe("plano: listas e contagem", () => {
  it("chave e rótulo por grupo e faixa", () => {
    assert.equal(chaveDaLista("PP", null), "PP");
    assert.equal(chaveDaLista("N1", "30"), "N1:30");
    assert.equal(chaveDaLista("N1", "errada"), "N1:90");
    assert.equal(chaveDaLista("CV", ""), "CV:todos");
    assert.equal(rotuloDaLista("N1", "30"), "Orçamento sem agendamento · recentes (até 30 dias)");
    assert.equal(rotuloDaLista("N1", "90"), "Orçamento sem agendamento · recentes");
    assert.equal(rotuloDaLista("C4", null), "Clientes · 91 dias a 1 ano");
  });
  it("opções de contagem cobrem todas as faixas", () => {
    const o = opcoesDeContagem();
    assert.deepEqual(o["N1:30"], { orcamento: { ate: 30 } });
    assert.deepEqual(o["C4"], { clientes: { de: 90, ate: 365 } });
    assert.deepEqual(o["CV:todos"], { conversa: {} });
    assert.deepEqual(o["PP"], { perdido_preco: {} });
  });
});

describe("plano: taxas, datas e limite", () => {
  it("taxas históricas só com 50 enviados; senão padrão", () => {
    const n = (enviados: number, responderam: number, fecharam: number, vendido: number) => ({
      enviados,
      erros: 0,
      responderam,
      orcamentos: 0,
      fecharam,
      vendido,
      custo: 0,
      retorno: null,
      descadastros: 0,
      bloqueios: 0,
      pctResposta: null,
      pctVenda: null,
    });
    assert.deepEqual(taxasHistoricas([n(40, 10, 2, 900)], 450), {
      resposta: 0.08,
      venda: 0.015,
      ticket: 450,
      historicas: false,
    });
    assert.deepEqual(taxasHistoricas([n(200, 30, 4, 1800), n(100, 12, 2, 1200)], 450), {
      resposta: 0.14,
      venda: 0.02,
      ticket: 500,
      historicas: true,
    });
  });
  it("próxima data de disparo respeita os dias da configuração", () => {
    // 02/11/2026 é segunda; dias 2,3,4 = ter, qua, qui.
    assert.equal(proximaDataDisparo("2026-11-02", 1, [2, 3, 4], false), "2026-11-03");
    assert.equal(proximaDataDisparo("2026-11-02", 3, [2, 3, 4], false), "2026-11-05");
    assert.equal(proximaDataDisparo("2026-11-02", 4, [2, 3, 4], false), "2026-11-10");
    assert.equal(proximaDataDisparo("2026-11-02", 0, [2, 3, 4], false), "2026-11-03");
    // Hora própria: qualquer dia, mas nunca hoje.
    assert.equal(proximaDataDisparo("2026-11-02", 4, [2, 3, 4], true), "2026-11-06");
  });
  it("limite de desconto: oferta da Alice em %, senão promoção da agenda, teto 25", () => {
    assert.equal(
      limiteDeDesconto({ ofertaLigada: true, ofertaTipo: "pct", ofertaValor: 10, promoPct: 20 }),
      10,
    );
    assert.equal(
      limiteDeDesconto({ ofertaLigada: true, ofertaTipo: "reais", ofertaValor: 50, promoPct: 20 }),
      20,
    );
    assert.equal(
      limiteDeDesconto({ ofertaLigada: false, ofertaTipo: "pct", ofertaValor: null, promoPct: 30 }),
      25,
    );
    assert.equal(
      limiteDeDesconto({
        ofertaLigada: false,
        ofertaTipo: "pct",
        ofertaValor: null,
        promoPct: null,
      }),
      20,
    );
  });
});

describe("plano: montagem da ação", () => {
  const ctx = {
    hoje: "2026-11-02",
    contagens: {
      "N1:30": { total: 40, podem: 25 },
      PP: { total: 8, podem: 8 },
      C4: { total: 120, podem: 90 },
    },
    modelosDaEmpresa: { orcamento: "tc_orcamento_retomada", oferta: "tc_oferta_trimestral" },
    custoMsg: 0.32,
    taxas: { resposta: 0.1, venda: 0.02, ticket: 500, historicas: true },
    limitePct: 10,
    diasDisparo: [2, 3, 4],
  };
  const ia: AcaoIA = {
    tipo: "oferta_prazo",
    titulo: "Oferta para quem sumiu depois do orçamento",
    porque: "Faltam R$ 24.000 e 25 orçamentos pararam.",
    grupo: "N1",
    faixa: "30",
    quantidade: 0,
    condicao_pct: 15,
    condicao_texto: "15% até sexta",
    texto: "Volta com desconto até sexta para quem orçou e sumiu.",
    dias_a_frente: 1,
    hora_inicio: "",
  };
  it("tamanho pelo 'podem', custo, venda esperada e desconto limitado pela regra", () => {
    const a = montarAcao(ia, 0, ctx)!;
    assert.equal(a.lista.nome, "Orçamento sem agendamento · recentes (até 30 dias)");
    assert.deepEqual(a.tamanho, { total: 40, podem: 25 });
    assert.equal(a.modelo, "tc_orcamento_retomada");
    assert.equal(a.custo, 8);
    assert.deepEqual(a.esperado, { respostas: 3, vendas: 0.5, valor: 250, descontoCusto: 25 });
    assert.equal(a.condicao.pct, 10);
    assert.equal(a.acimaDaRegra, true);
    assert.equal(a.data, "2026-11-03");
    assert.equal(a.status, "sugerida");
  });
  it("lista fora do tipo é descartada; quantidade limita o tamanho", () => {
    assert.equal(montarAcao({ ...ia, grupo: "C4" }, 0, ctx), null);
    const a = montarAcao({ ...ia, quantidade: 10, condicao_pct: 0, condicao_texto: "" }, 1, ctx)!;
    assert.equal(a.tamanho.podem, 10);
    assert.equal(a.custo, 3.2);
    assert.equal(a.condicao.semCondicao, true);
    assert.equal(a.acimaDaRegra, false);
  });
  it("entrada da campanha nova a partir da ação aprovada", () => {
    const a = montarAcao(ia, 0, ctx)!;
    const e = entradaDaAcao(a);
    assert.equal(e.nome, "Tatiana: Oferta para quem sumiu depois do orçamento");
    assert.deepEqual(e.listas, [
      { grupo: "N1", modelo: "tc_orcamento_retomada", faixa: "30", quantidade: null },
    ]);
    assert.equal(e.condicaoPct, 10);
    assert.equal(e.condicaoTexto, "15% até sexta");
    assert.deepEqual(e.datas, ["2026-11-03"]);
    assert.equal(e.quemResponde, "alice");
  });
  it("texto do push", () => {
    const a = montarAcao(ia, 0, ctx)!;
    assert.equal(textoPushPlano([a]).titulo, "Tatiana: 1 ação para aprovar hoje");
    assert.equal(textoPushPlano([a, a]).titulo, "Tatiana: 2 ações para aprovar hoje");
  });
});
