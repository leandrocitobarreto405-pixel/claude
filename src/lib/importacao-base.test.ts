import { test } from "node:test";
import assert from "node:assert/strict";
import { mapearColunas, MODELOS } from "./importacao-base";

test("modelo de compradores: cada coluna cai no campo certo", () => {
  assert.deepEqual(mapearColunas(MODELOS.comprador.colunas), {
    telefone: "Telefone",
    nome: "Nome",
    servico_em: "Data do serviço",
    servico_tipo: "Tipo do serviço",
  });
});

test("modelo de não compradores: 'Data de entrada' não vira data do serviço", () => {
  assert.deepEqual(mapearColunas(MODELOS.nao_comprador.colunas), {
    telefone: "Telefone",
    nome: "Nome",
    entrada_em: "Data de entrada",
    interesse: "Interesse",
    pediu_orcamento: "Pediu orçamento",
  });
});

test("planilhas da Turbine continuam reconhecidas", () => {
  assert.deepEqual(mapearColunas(["Telefone", "Nome", "Data do serviço", "Tipo do serviço"]), {
    telefone: "Telefone",
    nome: "Nome",
    servico_em: "Data do serviço",
    servico_tipo: "Tipo do serviço",
  });
  assert.deepEqual(
    mapearColunas([
      "Telefone",
      "Nome",
      "Entrada do lead",
      "Pediu orçamento (Sim/Não)",
      "Interesse",
    ]),
    {
      telefone: "Telefone",
      nome: "Nome",
      entrada_em: "Entrada do lead",
      interesse: "Interesse",
      pediu_orcamento: "Pediu orçamento (Sim/Não)",
    },
  );
});

test("nomes genéricos só valem no fim e cada coluna vai para um campo só", () => {
  assert.deepEqual(mapearColunas(["Celular", "Cliente", "Data", "Serviço"]), {
    telefone: "Celular",
    nome: "Cliente",
    servico_em: "Data",
    servico_tipo: "Serviço",
  });
  assert.deepEqual(mapearColunas(["fone", "Data entrada"]), {
    telefone: "fone",
    entrada_em: "Data entrada",
  });
});

test("os exemplos têm uma célula por coluna", () => {
  for (const m of Object.values(MODELOS)) {
    assert.equal(m.exemplos.length, 2);
    for (const linha of m.exemplos) assert.equal(linha.length, m.colunas.length);
  }
});
