import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAMILIAS,
  FAMILIAS_PROMOCAO,
  csvDaLista,
  linhasDaLista,
  pessoasDaFamilia,
  resumoDasListas,
  descreverFiltros,
  filtrosValidos,
  nomeDoFiltro,
  nomeDoGrupo,
  nomeDoSegmento,
  segmentosDaCampanha,
} from "./listas";

test("famílias e opções acumuladas", () => {
  assert.deepEqual(
    FAMILIAS.map((f) => f.familia),
    ["orcamento", "conversa", "clientes", "perdido_preco", "agendado"],
  );
  assert.deepEqual(
    FAMILIAS[0]!.opcoes.map((o) => o.rotulo),
    [
      "até 10 dias",
      "até 20 dias",
      "até 30 dias",
      "até 60 dias",
      "até 90 dias",
      "até 1 ano",
      "todos",
    ],
  );
  assert.ok(!FAMILIAS_PROMOCAO.some((f) => f.familia === "agendado"), "agendado fora da promoção");
  for (const f of FAMILIAS) assert.ok(f.explicacao.length > 20, `explicação de ${f.nome}`);
});

test("nomes claros, sem códigos", () => {
  assert.equal(nomeDoFiltro("orcamento", { ate: 10 }), "Orçamento sem agendamento · até 10 dias");
  assert.equal(
    nomeDoFiltro("orcamento", { de: 90, ate: 365 }),
    "Orçamento sem agendamento · de 91 dias a 1 ano",
  );
  assert.equal(nomeDoFiltro("orcamento", { de: 365 }), "Orçamento sem agendamento · mais de 1 ano");
  assert.equal(nomeDoFiltro("clientes", { de: 90, ate: 365 }), "Clientes · de 91 dias a 1 ano");
  assert.equal(nomeDoFiltro("clientes", {}), "Clientes · todos");
  assert.equal(
    descreverFiltros({ orcamento: { ate: 10 }, conversa: { ate: 30 } }),
    "Orçamento sem agendamento · até 10 dias + Conversou e não pediu orçamento · até 30 dias",
  );
  assert.doesNotMatch(descreverFiltros({ clientes: { de: 365 } }), /\b[CN]\d\b/);
});

test("filtros vindos da tela são limpos", () => {
  assert.deepEqual(
    filtrosValidos({ orcamento: { ate: 10 }, x: { ate: 1 }, clientes: { ate: -5 } }),
    {
      orcamento: { ate: 10 },
      clientes: {},
    },
  );
  assert.deepEqual(filtrosValidos({ conversa: { de: 40, ate: 10 } }), {});
  assert.deepEqual(filtrosValidos(null), {});
});

test("CSV para Excel: BOM, ponto e vírgula e aspas", () => {
  const csv = csvDaLista([
    {
      nome: 'Ana "Lu"; Souza',
      telefone: "5511910000001",
      familias: ["orcamento", "clientes"],
      dias_orcamento: 5,
      dias_conversa: null,
      dias_cliente: 100,
      servico_tipo: "higienizacao",
      orcamento_valor: 450.5,
      pode_receber: true,
      motivo: null,
    },
  ]);
  assert.ok(csv.startsWith("﻿Nome;Telefone;Listas"));
  assert.match(
    csv,
    /"Ana ""Lu""; Souza";5511910000001;Orçamento sem agendamento, Clientes;5;;100;Higienização;450,5;sim;$/,
  );
});

test("listas das campanhas: grupos antigos viram listas, sem códigos na tela", () => {
  const segs = segmentosDaCampanha(null, ["N1", "C4", "N3", "C2"]);
  assert.deepEqual(
    segs.map((s) => s.grupo),
    ["C4", "N1", "N3"],
  );
  assert.equal(nomeDoSegmento(segs[0]!), "Clientes · de 91 dias a 1 ano");
  assert.equal(nomeDoSegmento(segs[1]!), "Orçamento sem agendamento · até 90 dias");
  assert.equal(nomeDoSegmento(segs[2]!), "Orçamento sem agendamento · mais de 1 ano");
  const gravadas = segmentosDaCampanha(
    [
      { grupo: "CV", familia: "conversa", ate: 30 },
      { grupo: "X", familia: "nada" },
    ],
    ["N1"],
  );
  assert.deepEqual(gravadas, [{ grupo: "CV", familia: "conversa", ate: 30 }]);
  assert.equal(nomeDoGrupo("CV", gravadas), "Conversou e não pediu orçamento · até 30 dias");
  assert.equal(nomeDoGrupo("PP", []), "Perdido por preço");
  assert.doesNotMatch(nomeDoGrupo("N2", []), /\b[CN]\d\b/);
});

test("planilha: resumo por opção e linhas com números de verdade", () => {
  const p = (familias: string[], dias: Partial<Record<"o" | "c" | "k", number>>, pode = true) => ({
    nome: "X",
    telefone: "55119",
    familias,
    dias_orcamento: dias.o ?? null,
    dias_conversa: dias.c ?? null,
    dias_cliente: dias.k ?? null,
    servico_tipo: null,
    orcamento_valor: 300.5,
    pode_receber: pode,
    motivo: null,
  });
  const pessoas = [
    p(["orcamento"], { o: 5 }),
    p(["orcamento"], { o: 25 }, false),
    p(["orcamento", "clientes"], { o: 3, k: 120 }),
    p(["conversa"], { c: 15 }),
  ];
  const r = resumoDasListas(pessoas, "05/10/2026 09:00");
  const linha = (lista: string, opcao: string) => r.find((l) => l[0] === lista && l[1] === opcao);
  assert.deepEqual(linha("Orçamento sem agendamento", "até 10 dias"), [
    "Orçamento sem agendamento",
    "até 10 dias",
    2,
    2,
  ]);
  assert.deepEqual(linha("Orçamento sem agendamento", "até 30 dias"), [
    "Orçamento sem agendamento",
    "até 30 dias",
    3,
    2,
  ]);
  assert.deepEqual(linha("Clientes", "até 3 meses"), ["Clientes", "até 3 meses", 0, 0]);
  assert.deepEqual(linha("Clientes", "até 6 meses"), ["Clientes", "até 6 meses", 1, 1]);
  assert.deepEqual(linha("Conversou e não pediu orçamento", "todos"), [
    "Conversou e não pediu orçamento",
    "todos",
    1,
    1,
  ]);
  assert.deepEqual(pessoasDaFamilia(pessoas, "clientes").length, 1);
  const [cab, primeira] = linhasDaLista(pessoas);
  assert.equal(cab![7], "Valor do orçamento");
  assert.equal(primeira![7], 300.5);
});
