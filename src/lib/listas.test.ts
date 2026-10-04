import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAMILIAS,
  FAMILIAS_PROMOCAO,
  csvDaLista,
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
    "Orçamento sem agendamento · de 90 dias a 1 ano",
  );
  assert.equal(nomeDoFiltro("orcamento", { de: 365 }), "Orçamento sem agendamento · mais de 1 ano");
  assert.equal(nomeDoFiltro("clientes", { de: 90, ate: 365 }), "Clientes · de 90 dias a 1 ano");
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
  assert.equal(nomeDoSegmento(segs[0]!), "Clientes · de 90 dias a 1 ano");
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
