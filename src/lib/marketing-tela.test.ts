import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chipDaCampanha,
  diaMesCurto,
  proximasCampanhas,
  resultadosDoMes,
  simOuNao,
} from "./marketing-tela";

test("resultadosDoMes soma só o mês pedido", () => {
  const r = resultadosDoMes(
    [
      {
        campanha_id: "a",
        mes_ref: "2026-10-01",
        enviados: 300,
        respostas: 50,
        vendas: 6,
        valor_vendido: 2000,
      },
      {
        campanha_id: "b",
        mes_ref: "2026-10-01",
        enviados: 112,
        respostas: 28,
        vendas: 5,
        valor_vendido: 1640,
      },
      {
        campanha_id: "c",
        mes_ref: "2026-09-01",
        enviados: 999,
        respostas: 9,
        vendas: 9,
        valor_vendido: 9,
      },
      {
        campanha_id: "d",
        mes_ref: null,
        enviados: null,
        respostas: null,
        vendas: null,
        valor_vendido: null,
      },
    ],
    "2026-10",
  );
  assert.deepEqual(r, { enviados: 412, respostas: 78, vendas: 11, valor: 3640 });
});

test("proximasCampanhas: futuras e em andamento, por data", () => {
  const base = { tipo: "calendario", estimativa: null };
  const lista = proximasCampanhas(
    [
      { ...base, id: "1", nome: "Higienização", status: "aprovada", datas_disparo: ["2026-10-28"] },
      {
        ...base,
        id: "2",
        nome: "Reativação",
        status: "aguardando_aprovacao",
        datas_disparo: ["2026-10-17"],
        estimativa: { total: 24 },
      },
      { ...base, id: "3", nome: "Antiga", status: "concluida", datas_disparo: ["2026-09-10"] },
      { ...base, id: "4", nome: "Recusada", status: "recusada", datas_disparo: ["2026-10-20"] },
      {
        ...base,
        id: "5",
        nome: "Enviando",
        status: "enviando",
        datas_disparo: ["2026-09-30", "2026-10-01"],
      },
      { ...base, id: "6", nome: "Longe", status: "rascunho", datas_disparo: ["2027-03-01"] },
      {
        id: "7",
        nome: "Gatilho",
        tipo: "gatilho",
        status: "enviando",
        datas_disparo: null,
        estimativa: null,
      },
    ],
    "2026-10-02",
  );
  assert.deepEqual(
    lista.map((c) => c.id),
    ["5", "2", "1"],
  );
  assert.equal(lista[1]!.contatos, 24);
  assert.deepEqual(lista[1]!.chip, { rotulo: "Aprovar", tom: "atencao" });
});

test("chips e datas curtas", () => {
  assert.deepEqual(chipDaCampanha("pausada"), { rotulo: "Pausada", tom: "problema" });
  assert.deepEqual(chipDaCampanha("x"), { rotulo: "x", tom: "neutro" });
  assert.equal(diaMesCurto("2026-10-17"), "17 out");
});

test("coluna Pediu orçamento: Sim/Não/vazio", () => {
  for (const v of ["Sim", "sim", " SIM ", "S", "x", "1", true])
    assert.equal(simOuNao(v), true, String(v));
  for (const v of ["Não", "nao", "", null, undefined, "N", 0])
    assert.equal(simOuNao(v), false, String(v));
});
