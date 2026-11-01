import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  linhaDaMeta,
  resumoSemana,
  textoMesRelatorio,
  textoPushRelatorio,
  textoSemanaEquipe,
} from "./equipe";
import { metaDoMes } from "./mes";

describe("equipe: semana da equipe", () => {
  const agora = new Date("2026-11-08T12:00:00-03:00");
  const s = resumoSemana({
    agora,
    leads: ["2026-11-07", "2026-11-03", "2026-10-30", "2026-10-20"],
    orcamentos: ["2026-11-05T10:00:00-03:00", "2026-10-28T10:00:00-03:00"],
    vendas: [
      { data: "2026-11-06", valor: 900 },
      { data: "2026-11-02", valor: 450 },
      { data: "2026-10-27", valor: 300 },
    ],
    tarefas: [
      { status: "Concluída", pulada: false, quando: "2026-11-04T09:00:00-03:00" },
      { status: "Cancelada", pulada: true, quando: "2026-11-05T09:00:00-03:00" },
      { status: "Concluída", pulada: false, quando: "2026-10-25T09:00:00-03:00" },
      { status: "Pendente", pulada: false, quando: null },
    ],
    acertos: [
      { situacao: "resolvida", resolvidaEm: "2026-11-03T15:00:00-03:00" },
      { situacao: "pendente", resolvidaEm: null },
    ],
  });
  it("conta a semana e a anterior, sempre como equipe", () => {
    assert.equal(s.leads, 2);
    assert.equal(s.leadsAnterior, 1);
    assert.equal(s.orcamentos, 1);
    assert.equal(s.orcamentosAnterior, 1);
    assert.equal(s.vendas, 2);
    assert.equal(s.vendido, 1350);
    assert.equal(s.vendasAnterior, 1);
    assert.equal(s.vendidoAnterior, 300);
    assert.equal(s.tarefasFeitas, 1);
    assert.equal(s.tarefasPuladas, 1);
    assert.equal(s.tarefasPendentes, 1);
    assert.equal(s.acertosResolvidos, 1);
    assert.equal(s.acertosPendentes, 1);
  });
  it("texto curto sem nomes nem ranking", () => {
    assert.equal(
      textoSemanaEquipe(s),
      "2 leads (1 na semana anterior) · 1 orçamento (1) · 2 vendas (1) · R$ 1.350 · tarefas da Tatiana: 1 feita, 1 pulada, 1 pendente · acertos no app: 1 resolvido, 1 pendente",
    );
  });
  it("linha da meta com os dias vazios", () => {
    const meta = metaDoMes({
      meta: 30000,
      vendidoVenda: 4000,
      vendidoServico: { valor: 6000, realizado: 2000, agendado: 3500, atrasado: 500 },
      hoje: "2026-11-10",
      mes: "2026-11",
      diasUteis: [1, 2, 3, 4, 5, 6],
    });
    assert.equal(
      linhaDaMeta(meta, ["2026-11-12"]),
      "Faltam R$ 24.000 para R$ 30.000, com 18 dias úteis. São R$ 1.333 por dia útil. Agenda vazia em 12/11: vale encaixe.",
    );
    assert.equal(linhaDaMeta(meta, []).endsWith("por dia útil."), true);
  });
  it("bloco do mês para o relatório e push", () => {
    const meta = metaDoMes({
      meta: null,
      vendidoVenda: 0,
      vendidoServico: { valor: 0, realizado: 0, agendado: 0, atrasado: 0 },
      hoje: "2026-11-08",
      mes: "2026-11",
      diasUteis: [1, 2, 3, 4, 5, 6],
    });
    const linhas = textoMesRelatorio({
      frase: "Sem meta cadastrada.",
      meta,
      previsao: { total: 1200, chegaA: 1200, pctDaMeta: null },
      agenda: { livres: 10, base: 12, vazios: ["2026-11-10"] },
      alertas: ["Sem meta cadastrada para o mês"],
      planos: {
        propostas: 3,
        aprovadas: 1,
        recusadas: 1,
        pendentes: 1,
        campanhas: ["Tatiana: Oferta"],
      },
      semana: s,
    });
    assert.equal(linhas[0], "- Sem meta cadastrada.");
    assert.equal(
      linhas[1],
      "- Previsão pelos orçamentos abertos: R$ 1.200 (o mês chega a R$ 1.200).",
    );
    assert.equal(
      linhas[2],
      "- Agenda: 10 de 12 horários livres até o fim do mês; dias vazios 10/11.",
    );
    assert.equal(
      linhas[4],
      "- Plano de ação na semana: 3 ações propostas, 1 aprovada, 1 recusada, 1 sem decisão (rascunhos: Tatiana: Oferta).",
    );
    assert.equal(
      textoPushRelatorio("Semana de 02/11 a 08/11").titulo,
      "Tatiana: relatório da semana pronto",
    );
  });
});
