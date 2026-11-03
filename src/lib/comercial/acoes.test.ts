import { test } from "node:test";
import assert from "node:assert/strict";
import { avaliarVirarOs, formaParaOs, planejarAcoes, textoFeitoPelaTatiana } from "./acoes";
import type { AcertoLido } from "./tatiana";

const base = (a: Partial<AcertoLido> & Pick<AcertoLido, "tipo" | "texto">): AcertoLido => ({
  itens: [],
  cadastro: [],
  data: null,
  juntou: [],
  pagamento: { forma: "", parcelas: null, valor: null },
  ...a,
});
const estado = {
  osId: "os-1",
  osNumero: "1702",
  pagamentoLancado: false,
  temOrcamento: false,
  clienteId: "cli-1",
  cliente: { nome: "Cliente", cpf: null, endereco: null, email: null, cep: null },
  leadNome: "Cliente Fictício",
  telefone: "5511999990000",
};

test("forma lida vira o 'pagamento combinado' da OS", () => {
  assert.deepEqual(formaParaOs({ forma: "cartao", parcelas: 5, valor: 240 }), {
    metodo: "Crédito 5x",
    parcelas: 5,
  });
  assert.deepEqual(formaParaOs({ forma: "pix", parcelas: null, valor: 300 }), {
    metodo: "Pix",
    parcelas: 1,
  });
  assert.deepEqual(formaParaOs({ forma: "", parcelas: 3, valor: null }), {
    metodo: "3x",
    parcelas: 3,
  });
  assert.equal(formaParaOs({ forma: "", parcelas: null, valor: 100 }), null);
});

test("previsão de pagamento: só com OS, sem pagamento lançado e com forma combinada (caso 8486)", () => {
  const acerto = base({
    tipo: "pagamento",
    texto: "Combinou R$ 240 em 5x no cartão.",
    pagamento: { forma: "cartao", parcelas: 5, valor: 240 },
  });
  const [a] = planejarAcoes([acerto], estado);
  assert.equal(a?.tipo, "previsao_pagamento");
  assert.equal(a?.titulo, "Previsão de pagamento R$ 240 em 5x no cartão na OS 1702");
  assert.deepEqual(a?.dados, { osId: "os-1", metodo: "Crédito 5x", parcelas: 5, valor: 240 });
  // Sem OS, com pagamento lançado ou sem forma: nada.
  assert.equal(planejarAcoes([acerto], { ...estado, osId: null }).length, 0);
  assert.equal(planejarAcoes([acerto], { ...estado, pagamentoLancado: true }).length, 0);
  assert.equal(
    planejarAcoes(
      [
        base({
          tipo: "pagamento",
          texto: "Pagou.",
          pagamento: { forma: "", parcelas: null, valor: 240 },
        }),
      ],
      estado,
    ).length,
    0,
  );
});

test("orçamento em rascunho: só sem orçamento e sem OS, com itens com preço (caso 1836)", () => {
  const acerto = base({
    tipo: "orcamento_sem_app",
    texto: "O preço de R$ 320 do sofá foi passado na conversa.",
    itens: [
      { descricao: "Sofá 3 lugares", quantidade: 1, valor: 320 },
      { descricao: "Puff", quantidade: 2, valor: 40 },
      { descricao: "Tapete", quantidade: 1, valor: null },
    ],
  });
  const semOs = { ...estado, osId: null, osNumero: null };
  const [a] = planejarAcoes([acerto], semOs);
  assert.equal(a?.tipo, "orcamento_rascunho");
  assert.equal(a?.titulo, "Orçamento em rascunho: Sofá 3 lugares R$ 320, 2× Puff R$ 40");
  assert.equal(a?.tipo === "orcamento_rascunho" && a.dados.total, 400);
  assert.equal(a?.tipo === "orcamento_rascunho" && a.dados.itens.length, 2);
  assert.equal(planejarAcoes([acerto], { ...semOs, temOrcamento: true }).length, 0);
  assert.equal(planejarAcoes([acerto], estado).length, 0);
});

test("cadastro: só os campos vazios, com e-mail, CEP e CPF válidos", () => {
  const acerto = base({
    tipo: "pagamento",
    texto: "Mandou os dados.",
    cadastro: [
      { campo: "email", valor: "cliente@exemplo.test" },
      { campo: "cep", valor: "01420-006" },
      { campo: "cpf", valor: "123" },
      { campo: "nome", valor: "Outro Nome" },
    ],
  });
  const acoes = planejarAcoes([acerto], estado);
  const c = acoes.find((a) => a.tipo === "cadastro");
  assert.ok(c);
  assert.equal(c.titulo, "Cadastro: e-mail, CEP preenchidos pela conversa");
  assert.deepEqual(c.tipo === "cadastro" && c.dados.campos, {
    email: "cliente@exemplo.test",
    cep: "01420-006",
  });
  assert.equal(planejarAcoes([acerto], { ...estado, clienteId: null, cliente: null }).length, 0);
});

test("texto do aviso da manhã", () => {
  const t = textoFeitoPelaTatiana(
    [{ tipo: "previsao_pagamento" }, { tipo: "cadastro" }, { tipo: "cadastro" }],
    "ativo",
  );
  assert.equal(t.titulo, "Tatiana: 3 coisas feitas no app ontem à noite");
  assert.match(t.corpo, /^1 previsão de pagamento na os, 2 cadastro do cliente\./);
  assert.match(textoFeitoPelaTatiana([{ tipo: "cadastro" }], "teste").titulo, /faria 1 coisa/);
});

test("B7: vira OS só com data futura, hora ou período, nome, CEP, número, pagamento e dentro da área", () => {
  const agendamento = {
    hora: "",
    periodo: "manha" as const,
    nome_completo: "Cliente Fictício da Silva",
    cep: "01420-006",
    numero: "120",
    complemento: "ap 42",
    pagamento: "pix" as const,
    parcelas: null,
  };
  const acerto = base({
    tipo: "fechou_sem_os",
    texto: "Fechou para 16/11 de manhã.",
    data: "2026-11-16",
    agendamento,
  });
  const e = {
    ...estado,
    osId: null,
    osNumero: null,
    hoje: "2026-11-03",
    orcamentosAbertos: [{ numero: 153, distanciaKm: 12, foraDaArea: false }],
  };
  const [a] = planejarAcoes([acerto], e);
  assert.equal(a?.tipo, "virar_os");
  assert.equal(a?.titulo, "Orçamento Nº 0153 virou OS, agendada para 16/11 de manhã");
  assert.deepEqual(a?.tipo === "virar_os" && [a.dados.cep, a.dados.periodo, a.dados.hora], [
    "01420006",
    "manha",
    null,
  ]);
  // Acima de 35 km: nunca cria (caso de 45 km).
  const longe = avaliarVirarOs(acerto, {
    ...e,
    orcamentosAbertos: [{ numero: 153, distanciaKm: 45, foraDaArea: false }],
  });
  assert.equal(longe.ok, false);
  assert.match(!longe.ok ? longe.motivo : "", /fora da área \(45 km, limite 35 km\)/);
  // Faltou dado: diz o que faltou.
  const falta = avaliarVirarOs(
    base({ ...acerto, agendamento: { ...agendamento, periodo: "", cep: "", pagamento: "" } }),
    e,
  );
  assert.equal(
    !falta.ok && falta.motivo,
    "faltou o horário ou o período, o CEP, a forma de pagamento na conversa",
  );
  // Data de hoje ou passada, sem orçamento ou já com OS: não cria.
  assert.equal(avaliarVirarOs(base({ ...acerto, data: "2026-11-03" }), e).ok, false);
  assert.equal(avaliarVirarOs(acerto, { ...e, orcamentosAbertos: [] }).ok, false);
  assert.equal(avaliarVirarOs(acerto, { ...e, osId: "os-1" }).ok, false);
});
