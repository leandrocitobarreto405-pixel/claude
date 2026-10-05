import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diasTexto,
  listaFria,
  modeloSugerido,
  ordemDosLotes,
  proximasDatas,
  validarNovaCampanha,
  type EntradaNovaCampanha,
} from "./campanha-nova";

const modelos = {
  oferta: "tc_oferta_trimestral",
  reativacao: "tc_reativacao_cliente",
  orcamento: "tc_orcamento_retomada",
  conversa: "tc_conversa_retomada",
  preco: "tc_preco_retomada",
};
const ctx = { hoje: "2026-10-05", dias: [2, 3, 4] };
const base: EntradaNovaCampanha = {
  nome: "  Outubro   geral ",
  listas: [
    { grupo: "CV", modelo: "tc_conversa_retomada", faixaConversa: "todos" },
    { grupo: "N3", modelo: "tc_orcamento_retomada" },
    { grupo: "C5", modelo: "tc_reativacao_cliente" },
    { grupo: "N2", modelo: "tc_orcamento_retomada" },
  ],
  semCondicao: false,
  condicaoTexto: "10% na higienização",
  condicaoPct: 10,
  datas: ["2026-10-08", "2026-10-06", "2026-10-07"],
  quemResponde: "equipe",
};

test("modelo sugerido de cada lista vem dos nomes da empresa", () => {
  assert.equal(modeloSugerido("C4", modelos), "tc_oferta_trimestral");
  assert.equal(modeloSugerido("C5", modelos), "tc_reativacao_cliente");
  assert.equal(modeloSugerido("N1", modelos), "tc_orcamento_retomada");
  assert.equal(modeloSugerido("N3", modelos), "tc_orcamento_retomada");
  assert.equal(modeloSugerido("CV", modelos), "tc_conversa_retomada");
  assert.equal(modeloSugerido("PP", modelos), "tc_preco_retomada");
  assert.equal(modeloSugerido("PP", {}), "preco_retomada");
});

test("lotes: quentes primeiro (clientes, orçamentos recentes), frias por último", () => {
  const ordem = ordemDosLotes([
    { grupo: "CV", familia: "conversa" },
    { grupo: "N3", familia: "orcamento", de: 365 },
    { grupo: "C5", familia: "clientes", de: 365 },
    { grupo: "N2", familia: "orcamento", de: 90 },
    { grupo: "C4", familia: "clientes", de: 90 },
    { grupo: "N1", familia: "orcamento" },
  ]).map((s) => s.grupo);
  assert.deepEqual(ordem, ["C4", "C5", "N1", "N2", "N3", "CV"]);
  assert.ok(listaFria({ familia: "orcamento", de: 365 }));
  assert.ok(listaFria({ familia: "conversa" }));
  assert.ok(!listaFria({ familia: "orcamento", de: 90 }));
});

test("campanha válida: nome limpo, listas, modelos, datas em ordem e mês", () => {
  const r = validarNovaCampanha(base, ctx);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.campanha.nome, "Outubro geral");
  assert.deepEqual(r.campanha.datas, ["2026-10-06", "2026-10-07", "2026-10-08"]);
  assert.equal(r.campanha.mesRef, "2026-10-01");
  assert.equal(r.campanha.quemResponde, "equipe");
  assert.deepEqual(r.campanha.listas[0], { grupo: "CV", familia: "conversa" });
  assert.deepEqual(r.campanha.listas[1], { grupo: "N3", familia: "orcamento", de: 365 });
  assert.equal(r.campanha.templates["N2"], "tc_orcamento_retomada");
  const conv = validarNovaCampanha(
    { ...base, listas: [{ grupo: "CV", modelo: "x", faixaConversa: "30" }] },
    ctx,
  );
  assert.ok(conv.ok && conv.campanha.listas[0]!.ate === 30);
});

test("problemas: data fora dos dias, data passada, sem lista, sem condição escrita", () => {
  const r = validarNovaCampanha(
    {
      ...base,
      nome: "x",
      listas: [],
      condicaoTexto: "",
      condicaoPct: null,
      datas: ["2026-10-05", "2026-10-10"],
    },
    ctx,
  );
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.ok(r.problemas.some((p) => /nome/.test(p)));
  assert.ok(r.problemas.some((p) => /pelo menos uma lista/.test(p)));
  assert.ok(r.problemas.some((p) => /Sem condição/.test(p)));
  assert.ok(r.problemas.some((p) => /05\/10\/2026 já passou/.test(p)));
  assert.ok(r.problemas.some((p) => /10\/10\/2026 não é um dos dias/.test(p)));
  const pct = validarNovaCampanha({ ...base, condicaoPct: 30 }, ctx);
  assert.ok(!pct.ok);
  const sem = validarNovaCampanha({ ...base, semCondicao: true, condicaoTexto: "" }, ctx);
  assert.ok(sem.ok && sem.campanha.condicaoTexto === null && sem.campanha.condicaoPct === null);
});

test("próximas datas permitidas e o texto dos dias", () => {
  assert.deepEqual(proximasDatas("2026-10-05", [2, 3, 4], 4), [
    "2026-10-06",
    "2026-10-07",
    "2026-10-08",
    "2026-10-13",
  ]);
  assert.equal(diasTexto([4, 2, 3]), "terça, quarta e quinta");
  assert.equal(diasTexto([1]), "segunda");
});
