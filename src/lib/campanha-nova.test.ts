import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diasTexto,
  listaFria,
  modeloSugerido,
  modelosAprovados,
  ordemDosLotes,
  previaDoModelo,
  proximasDatas,
  quantidadeDaFracao,
  repetirCampanha,
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
    { grupo: "CV", modelo: "tc_conversa_retomada", faixa: "todos" },
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
    { ...base, listas: [{ grupo: "CV", modelo: "x", faixa: "30" }] },
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

test("só modelos aprovados no idioma da empresa, com aviso da versão _sn", () => {
  const form = (corpo: string) => ({
    nome: "",
    idioma: "pt_BR",
    categoria: "MARKETING" as const,
    cabecalho: "",
    corpo,
    exemplos: [],
    rodape: "",
    botoes: [{ tipo: "QUICK_REPLY" as const, texto: "Quero aproveitar!" }],
  });
  const lista = modelosAprovados(
    [
      {
        nome: "tc_oferta",
        idioma: "pt_BR",
        status: "APPROVED",
        categoria: "MARKETING",
        form: form("Oi, {{1}}!"),
      },
      {
        nome: "tc_oferta_sn",
        idioma: "pt_BR",
        status: "APPROVED",
        categoria: "MARKETING",
        form: form("Oi!"),
      },
      {
        nome: "tc_conversa",
        idioma: "pt_BR",
        status: "APPROVED",
        categoria: "MARKETING",
        form: form("Oi, {{1}}! Temos {{2}}."),
      },
      {
        nome: "tc_orcamento",
        idioma: "pt_BR",
        status: "PENDING",
        categoria: "MARKETING",
        form: form("x"),
      },
      {
        nome: "tc_ingles",
        idioma: "en_US",
        status: "APPROVED",
        categoria: "MARKETING",
        form: form("x"),
      },
    ],
    "pt_BR",
  );
  assert.deepEqual(
    lista.map((m) => `${m.nome}:${m.temSn}`),
    ["tc_conversa:false", "tc_oferta:true"],
  );
  const p = previaDoModelo(lista[0]!.form, "10% na higienização");
  assert.equal(p.texto, "Oi, Ana! Temos 10% na higienização.");
  assert.ok(p.usaCondicao);
  assert.deepEqual(p.botoes, ["Quero aproveitar!"]);
  assert.match(previaDoModelo(lista[0]!.form, null).texto, /\[condição da campanha\]/);
  assert.ok(!previaDoModelo(lista[1]!.form, null).usaCondicao);
});

test("quantas pessoas por lista: um terço, dois terços ou um número", () => {
  assert.equal(quantidadeDaFracao(264, "1/3"), 88);
  assert.equal(quantidadeDaFracao(264, "2/3"), 176);
  assert.equal(quantidadeDaFracao(1, "1/3"), 1);
  const r = validarNovaCampanha(
    {
      ...base,
      listas: [
        { grupo: "C5", modelo: "tc_reativacao_cliente", quantidade: 88 },
        { grupo: "N1", modelo: "tc_orcamento_retomada", faixa: "20" },
        { grupo: "N3", modelo: "tc_orcamento_retomada", quantidade: null },
      ],
    },
    ctx,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.campanha.limites, { C5: 88 });
  assert.deepEqual(r.campanha.listas[1], { grupo: "N1", familia: "orcamento", ate: 20 });
  const ruim = validarNovaCampanha(
    { ...base, listas: [{ grupo: "C5", modelo: "x", quantidade: 0 }] },
    ctx,
  );
  assert.ok(!ruim.ok && ruim.problemas.some((p) => /quantidade/.test(p)));
});

test("dia e horário próprios: qualquer dia e hoje se ainda der tempo", () => {
  const agora = { ...ctx, agora: "13:00" };
  // Segunda (hoje) às 14:00 e sábado: valem com horário próprio.
  const ok = validarNovaCampanha(
    { ...base, horaInicio: "14:00", datas: ["2026-10-05", "2026-10-10"] },
    agora,
  );
  assert.ok(ok.ok && ok.campanha.horaInicio === "14:00");
  // Hoje às 13:20 (menos de 30 min): não dá.
  const cedo = validarNovaCampanha({ ...base, horaInicio: "13:20", datas: ["2026-10-05"] }, agora);
  assert.ok(!cedo.ok && cedo.problemas.some((p) => /30 minutos/.test(p)));
  // Fora de 8h–20h.
  const noite = validarNovaCampanha({ ...base, horaInicio: "21:00", datas: ["2026-10-06"] }, agora);
  assert.ok(!noite.ok && noite.problemas.some((p) => /08:00 às 20:00/.test(p)));
  // Sem horário próprio, sábado continua fora.
  const sab = validarNovaCampanha({ ...base, datas: ["2026-10-10"] }, agora);
  assert.ok(!sab.ok);
  assert.deepEqual(proximasDatas("2026-10-05", [1, 2, 3, 4, 5, 6, 7], 2, true), [
    "2026-10-05",
    "2026-10-06",
  ]);
});

test("mandar para quem ficou de fora: mesmas listas, faixas, modelos e condição", () => {
  const r = repetirCampanha({
    id: "c0000000-0000-0000-0000-000000000001",
    nome: "Outubro",
    listas: [
      { grupo: "C5", familia: "clientes", de: 365 },
      { grupo: "N1", familia: "orcamento", ate: 20 },
      { grupo: "CV", familia: "conversa" },
    ],
    grupos: null,
    templates: { C5: "tc_reativacao_cliente", N1: "tc_orcamento_retomada" },
    condicao_texto: "10% na higienização",
    condicao_pct: 10,
    quem_responde: "equipe",
  });
  assert.equal(r.nome, "Outubro (resto)");
  assert.deepEqual(r.listas, [
    { grupo: "C5", modelo: "tc_reativacao_cliente" },
    { grupo: "N1", modelo: "tc_orcamento_retomada", faixa: "20" },
    { grupo: "CV", modelo: "", faixa: "todos" },
  ]);
  assert.equal(r.condicaoPct, 10);
  assert.equal(r.quemResponde, "equipe");
  assert.equal(r.repeteDe, "c0000000-0000-0000-0000-000000000001", "liga à original (retirados)");
});
