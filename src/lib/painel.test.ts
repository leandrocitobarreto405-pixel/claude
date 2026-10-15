import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atalhosDoPapel,
  conversao,
  intervalosDoPeriodo,
  percentualDaMetaComAgendado,
  semanasAte,
  textoVariacao,
  ticketMedio,
  variacao,
  vendidoPorOrigem,
  vendidoPorSemana,
} from "./painel";

test("períodos: hoje/ontem, semana (seg-dom) e semana passada, mês e mês passado", () => {
  // 14/10/2026 é uma quarta-feira.
  assert.deepEqual(intervalosDoPeriodo("hoje", "2026-10-14"), {
    atual: { de: "2026-10-14", ate: "2026-10-14" },
    anterior: { de: "2026-10-13", ate: "2026-10-13" },
    comparacao: "ontem",
  });
  assert.deepEqual(intervalosDoPeriodo("semana", "2026-10-14"), {
    atual: { de: "2026-10-12", ate: "2026-10-18" },
    anterior: { de: "2026-10-05", ate: "2026-10-11" },
    comparacao: "semana passada",
  });
  assert.deepEqual(intervalosDoPeriodo("mes", "2026-10-14"), {
    atual: { de: "2026-10-01", ate: "2026-10-31" },
    anterior: { de: "2026-09-01", ate: "2026-09-30" },
    comparacao: "mês passado",
  });
});

test("variação e texto", () => {
  assert.equal(variacao(120, 100), 20);
  assert.equal(variacao(80, 100), -20);
  assert.equal(variacao(50, 0), null);
  assert.equal(textoVariacao(12.4), "+12%");
  assert.equal(textoVariacao(-7.6), "−8%");
  assert.equal(textoVariacao(0.2), "0%");
  assert.equal(textoVariacao(null), "—");
});

test("ticket médio e conversão sem dividir por zero", () => {
  assert.equal(ticketMedio(1000, 4), 250);
  assert.equal(ticketMedio(1000, 0), 0);
  assert.equal(conversao(3, 12), 25);
  assert.equal(conversao(0, 0), null);
});

test("8 semanas até a atual, cada uma de segunda a domingo", () => {
  const s = semanasAte("2026-10-14", 8);
  assert.equal(s.length, 8);
  assert.deepEqual(s[0], { de: "2026-08-24", ate: "2026-08-30", rotulo: "24/08" });
  assert.deepEqual(s[7], { de: "2026-10-12", ate: "2026-10-18", rotulo: "12/10" });
});

test("vendido por semana e por origem", () => {
  const vendas = [
    { sale_date: "2026-10-12", valor: 300, origem: "Google" },
    { sale_date: "2026-10-13", valor: 200.5, origem: "Google" },
    { sale_date: "2026-10-06", valor: 100, origem: null },
    { sale_date: "2026-08-01", valor: 999, origem: "Indicação" }, // fora das 8 semanas
  ];
  const porSemana = vendidoPorSemana(vendas, semanasAte("2026-10-14", 2));
  assert.deepEqual(
    porSemana.map((s) => [s.rotulo, s.valor, s.quantidade]),
    [
      ["05/10", 100, 1],
      ["12/10", 500.5, 2],
    ],
  );
  assert.deepEqual(vendidoPorOrigem(vendas), [
    { origem: "Indicação", valor: 999, quantidade: 1 },
    { origem: "Google", valor: 500.5, quantidade: 2 },
    { origem: "Sem origem", valor: 100, quantidade: 1 },
  ]);
});

test("meta conta realizado + agendado; sem meta, null", () => {
  assert.equal(percentualDaMetaComAgendado(6000, 2000, 10000), 80);
  assert.equal(percentualDaMetaComAgendado(6000, 2000, null), null);
  assert.equal(percentualDaMetaComAgendado(6000, 2000, 0), null);
});

test("atalhos: admin vê todos; atendente sem Financeiro, Operação, Notas, Exportações e Configurações", () => {
  assert.deepEqual(
    atalhosDoPapel("admin").map((a) => a.id),
    [
      "financeiro",
      "os",
      "agenda",
      "conversas",
      "marketing",
      "google",
      "funil",
      "retornos",
      "operacao",
      "notas",
      "exportacoes",
      "configuracoes",
    ],
  );
  assert.deepEqual(
    atalhosDoPapel("atendente").map((a) => a.id),
    ["os", "agenda", "conversas", "marketing", "google", "funil", "retornos"],
  );
  // O técnico abre na Agenda, mas se chegasse aqui só veria o que pode abrir.
  assert.deepEqual(
    atalhosDoPapel("tecnico").map((a) => a.id),
    ["agenda"],
  );
});
