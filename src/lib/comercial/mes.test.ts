import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agendaPorDia,
  alertasDoMes,
  conversaoPorServico,
  diasUteisEntre,
  diasVazios,
  fimDoMes,
  fraseDaMeta,
  metaDoMes,
  previsaoDosOrcamentos,
  semanaDe,
  servicoDoTexto,
  servicoDosItens,
  textoPushAlertas,
} from "./mes";

const SEG_SAB = [1, 2, 3, 4, 5, 6];

describe("mês: dias úteis e meta", () => {
  it("fim do mês e dias úteis seg–sáb", () => {
    assert.equal(fimDoMes("2026-11"), "2026-11-30");
    assert.equal(fimDoMes("2026-02"), "2026-02-28");
    // 02/11 (segunda) a 08/11 (domingo): seg–sáb = 6 dias.
    assert.deepEqual(diasUteisEntre("2026-11-02", "2026-11-08", SEG_SAB).length, 6);
    assert.deepEqual(diasUteisEntre("2026-11-02", "2026-11-08", [1, 2, 3, 4, 5]).length, 5);
  });
  it("falta, dias úteis restantes e ritmo por dia útil", () => {
    const m = metaDoMes({
      meta: 30000,
      vendidoVenda: 4000,
      vendidoServico: { valor: 6000, realizado: 2000, agendado: 3500, atrasado: 500 },
      hoje: "2026-11-10",
      mes: "2026-11",
      diasUteis: SEG_SAB,
    });
    assert.equal(m.falta, 24000);
    assert.equal(m.pct, 20);
    // 10/11 (terça) a 30/11: 18 dias úteis seg–sáb; 01/11 a 09/11: 7 passados.
    assert.equal(m.diasUteisRestantes, 18);
    assert.equal(m.diasUteisPassados, 7);
    assert.equal(m.ritmoNecessario, 1333.33);
    assert.equal(m.ritmoAtual, 285.71);
    assert.equal(
      fraseDaMeta(m),
      "Faltam R$ 24.000 para R$ 30.000, com 18 dias úteis. São R$ 1.333 por dia útil.",
    );
  });
  it("sem meta: nada de falta nem ritmo", () => {
    const m = metaDoMes({
      meta: 0,
      vendidoVenda: 0,
      vendidoServico: { valor: 100, realizado: 100, agendado: 0, atrasado: 0 },
      hoje: "2026-11-02",
      mes: "2026-11",
      diasUteis: SEG_SAB,
    });
    assert.equal(m.meta, null);
    assert.equal(m.falta, null);
    assert.equal(m.ritmoNecessario, null);
    assert.equal(fraseDaMeta(m), "Sem meta cadastrada.");
  });
});

describe("mês: previsão pelos orçamentos abertos", () => {
  it("serviço pelo texto e pelos itens", () => {
    assert.equal(servicoDoTexto("higienização de sofá 3 lugares"), "higienizacao");
    assert.equal(servicoDoTexto("Impermeabilização, sofá"), "impermeabilizacao");
    assert.equal(servicoDoTexto("higienização + impermeabilização"), "ambos");
    assert.equal(servicoDoTexto(null), "outro");
    assert.equal(servicoDosItens(["higienizacao", "higienizacao"]), "higienizacao");
    assert.equal(servicoDosItens(["higienizacao", "impermeabilizacao"]), "ambos");
    assert.equal(servicoDosItens([]), "outro");
  });
  it("conversão histórica só com 5 fichas com orçamento; senão vale o padrão", () => {
    const fichas = [
      ...Array.from({ length: 8 }, () => ({
        servico: "higienização",
        resultado: "perdeu" as const,
      })),
      ...Array.from({ length: 2 }, () => ({
        servico: "higienização",
        resultado: "vendeu" as const,
      })),
      { servico: "higienização", resultado: "sem_orcamento" as const },
      { servico: "impermeabilização", resultado: "vendeu" as const },
    ];
    const conv = conversaoPorServico(fichas);
    assert.equal(conv.higienizacao.comOrcamento, 10);
    assert.equal(conv.higienizacao.conversao, 0.2);
    assert.equal(conv.impermeabilizacao.conversao, null);
    const p = previsaoDosOrcamentos(
      [
        { id: "a", total: 1000, servico: "higienizacao" },
        { id: "b", total: 500, servico: "higienizacao" },
        { id: "c", total: 2000, servico: "impermeabilizacao" },
      ],
      conv,
    );
    assert.equal(p.porServico[0]!.previsto, 300);
    assert.equal(p.porServico[0]!.base, "servico");
    // Impermeabilização sem 5 fichas: vale a conversão da empresa toda (3 vendas em 11).
    assert.equal(p.porServico[1]!.base, "geral");
    assert.equal(p.porServico[1]!.conversao, 0.273);
    assert.equal(p.porServico[1]!.previsto, 546);
    assert.equal(p.total, 846);
    // Sem histórico nenhum: padrão de 30%.
    const semHistorico = previsaoDosOrcamentos(
      [{ id: "z", total: 1000, servico: "outro" }],
      conversaoPorServico([]),
    );
    assert.equal(semHistorico.porServico[0]!.base, "padrao");
    assert.equal(semHistorico.porServico[0]!.previsto, 300);
  });
});

describe("mês: agenda e alertas", () => {
  const base = [
    { tecnicoId: "t1", tecnico: "Téc 1", diaSemana: 2, hora: "08:00" },
    { tecnicoId: "t1", tecnico: "Téc 1", diaSemana: 2, hora: "13:00" },
    { tecnicoId: "t1", tecnico: "Téc 1", diaSemana: 3, hora: "08:00" },
    { tecnicoId: "t1", tecnico: "Téc 1", diaSemana: 4, hora: "08:00" },
  ];
  it("capacidade real e feriado (02/11): 9h30 ocupa o das 8h, dia inteiro por valor, feriado fora", () => {
    const dias = agendaPorDia({
      de: "2026-11-03",
      ate: "2026-11-05",
      diasUteis: SEG_SAB,
      base,
      ocupacoes: new Map([
        ["2026-11-03", [{ tecnicoId: "t1", hora: "09:30", status: "Agendado", valor: 400 }]],
        ["2026-11-05", [{ tecnicoId: "t1", hora: "11:00", status: "Agendado", valor: 1145.96 }]],
      ]),
      feriados: new Map([["2026-11-04", "Feriado de teste"]]),
    });
    assert.deepEqual(
      dias.map((d) => [d.data, d.base, d.ocupados, d.livres, d.feriado ?? null]),
      [
        ["2026-11-03", 2, 1, 1, null],
        ["2026-11-04", 0, 0, 0, "Feriado de teste"],
        ["2026-11-05", 1, 1, 0, null],
      ],
    );
    // Feriado não é "dia vazio" nem conta como dia útil da meta.
    assert.deepEqual(diasVazios(dias, "2026-11-02"), []);
    assert.equal(
      diasUteisEntre("2026-11-02", "2026-11-08", SEG_SAB, new Map([["2026-11-04", "x"]])).length,
      5,
    );
  });
  it("horários livres por dia e dias vazios nos próximos 3 dias úteis", () => {
    const dias = agendaPorDia({
      de: "2026-11-02",
      ate: "2026-11-05",
      diasUteis: SEG_SAB,
      base,
      ocupacoes: new Map([
        ["2026-11-03", [{ tecnicoId: "t1", hora: "08:00", status: "Agendado" }]],
      ]),
    });
    assert.deepEqual(
      dias.map((d) => [d.data, d.base, d.ocupados, d.livres]),
      [
        ["2026-11-02", 0, 0, 0],
        ["2026-11-03", 2, 1, 1],
        ["2026-11-04", 1, 0, 1],
        ["2026-11-05", 1, 0, 1],
      ],
    );
    assert.deepEqual(
      diasVazios(dias, "2026-11-02").map((d) => d.data),
      ["2026-11-04", "2026-11-05"],
    );
  });
  it("semana começa na segunda", () => {
    assert.equal(semanaDe("2026-11-05"), "2026-11-02");
    assert.equal(semanaDe("2026-11-08"), "2026-11-02");
    assert.equal(semanaDe("2026-11-02"), "2026-11-02");
  });
  it("alertas: sem meta, dia vazio, queda de leads, conversão, objeção e agenda vazia", () => {
    const agenda = [
      { data: "2026-11-03", base: 2, ocupados: 0, livres: 2 },
      { data: "2026-11-04", base: 2, ocupados: 1, livres: 1 },
      { data: "2026-11-05", base: 2, ocupados: 0, livres: 2 },
      { data: "2026-11-06", base: 2, ocupados: 0, livres: 2 },
    ];
    const alertas = alertasDoMes({
      hoje: "2026-11-02",
      mes: "2026-11",
      meta: null,
      agenda,
      leadsPorOrigem: [
        { origem: "Google", atual: 3, media4: 10 },
        { origem: "Instagram", atual: 2, media4: 3 },
        { origem: "Indicação", atual: 6, media4: 8 },
      ],
      conversaoPorServico: [
        {
          servico: "higienizacao",
          atual: { comOrcamento: 20, vendas: 2 },
          anterior: { comOrcamento: 20, vendas: 6 },
        },
        {
          servico: "impermeabilizacao",
          atual: { comOrcamento: 4, vendas: 0 },
          anterior: { comOrcamento: 12, vendas: 6 },
        },
      ],
      objecoes: [
        { nome: "Achou caro", n: 4 },
        { nome: "Sumiu", n: 2 },
      ],
      perdidos14d: 8,
      campanhas: [
        { id: "k1", nome: "Retomada 60 dias", enviados: 151, descadastros: 14 },
        { id: "k2", nome: "Calendário", enviados: 50, descadastros: 2 },
        { id: "k3", nome: "Teste pequeno", enviados: 10, descadastros: 3 },
      ],
    });
    assert.deepEqual(
      alertas.map((a) => a.chave),
      [
        "sem_meta:2026-11",
        "dia_vazio:2026-11-03",
        "dia_vazio:2026-11-05",
        "queda_leads:Google:2026-11-02",
        "queda_conversao:higienizacao:2026-11-02",
        "objecao:2026-11-02",
        "agenda_vazia:2026-11-02",
        "descadastro:k1",
      ],
    );
    assert.equal(alertas[7]!.titulo, "Descadastro de 9,3% na campanha Retomada 60 dias");
    assert.match(alertas[7]!.texto, /^14 de 151 pediram para parar \(limite 5%\)/);
    assert.equal(
      alertas[3]!.texto,
      "3 nos últimos 7 dias contra uma média de 10 por semana nas 4 anteriores.",
    );
    assert.equal(
      alertas[4]!.texto,
      "10% de quem recebeu orçamento fechou nos últimos 28 dias, contra 30% nos 28 anteriores.",
    );
    const push = textoPushAlertas(alertas);
    assert.equal(push.titulo, "Tatiana: 8 alertas do mês");
    assert.equal(textoPushAlertas([alertas[1]!]).titulo, "Tatiana: Agenda vazia em 03/11");
  });
  it("sem sinal, sem alerta", () => {
    assert.deepEqual(
      alertasDoMes({
        hoje: "2026-11-02",
        mes: "2026-11",
        meta: 10000,
        agenda: [{ data: "2026-11-03", base: 2, ocupados: 2, livres: 0 }],
        leadsPorOrigem: [{ origem: "Google", atual: 9, media4: 10 }],
        conversaoPorServico: [],
        objecoes: [{ nome: "Achou caro", n: 2 }],
        perdidos14d: 8,
      }),
      [],
    );
  });
});
