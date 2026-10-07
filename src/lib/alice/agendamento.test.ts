import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avisoAgendamento,
  casarVendedora,
  ecoAutomatico,
  escolherOrigem,
  escolherVendedora,
  proximoNumeroOS,
  valoresDaReserva,
  visitasDosOrcamentos,
  type OrcamentoReserva,
  type Vendedora,
} from "./agendamento";

test("número da OS: maior + 1, com 4 dígitos", () => {
  assert.equal(proximoNumeroOS(["1623", "1624", "abc"]), "1625");
  assert.equal(proximoNumeroOS(["OS-0009"]), "0010");
  assert.equal(proximoNumeroOS([]), "0001");
});

const hig: OrcamentoReserva = {
  id: "q1",
  total: 839.7,
  pix: 797.72,
  desconto: 0,
  parcelas: 6,
  itens: [
    {
      tabelaItemId: "sofa",
      nome: "Sofá-cama até 2,50 m",
      servico: "higienizacao",
      preco: 359.9,
      quantidade: 1,
    },
    {
      tabelaItemId: "cad",
      nome: "Cadeira assento + encosto (unidade)",
      servico: "higienizacao",
      preco: 55,
      quantidade: 4,
    },
    {
      tabelaItemId: "polt",
      nome: "Poltrona",
      servico: "higienizacao",
      preco: 129.9,
      quantidade: 2,
    },
  ],
};
const imp: OrcamentoReserva = {
  id: "q2",
  total: 649.9,
  pix: 617.41,
  desconto: 0,
  parcelas: 6,
  itens: [
    {
      tabelaItemId: "sofa",
      nome: "Sofá-cama até 2,50 m",
      servico: "impermeabilizacao",
      preco: 649.9,
      quantidade: 1,
    },
  ],
};

test("um atendimento por serviço; o mesmo item fica no mesmo grupo", () => {
  const v = visitasDosOrcamentos([imp, hig]);
  assert.deepEqual(
    v.map((x) => x.servico),
    ["higienizacao", "impermeabilizacao"],
  );
  assert.equal(v[0]!.itens.length, 3);
  assert.equal(v[0]!.itens[0]!.description, "Sofá-cama até 2,50 m");
  assert.equal(v[0]!.itens[0]!.grupo, v[1]!.itens[0]!.grupo, "sofá nos dois serviços");
  assert.notEqual(v[0]!.itens[1]!.grupo, v[0]!.itens[0]!.grupo);
});

test("valores: Pix usa o preço do Pix; cartão usa o total e as parcelas do orçamento", () => {
  const pix = valoresDaReserva([hig], "pix", null, 5);
  assert.equal(pix.somaItens, 839.7);
  assert.equal(pix.total, 797.72);
  assert.equal(pix.forma, "Pix");
  assert.equal(pix.parcelas, 1);
  assert.match(pix.motivoAjuste ?? "", /5% no Pix/);

  const cartao = valoresDaReserva([hig, imp], "cartao", 3, 5);
  assert.equal(cartao.total, 1489.6);
  assert.equal(cartao.forma, "Crédito");
  assert.equal(cartao.parcelas, 3);
  assert.equal(cartao.motivoAjuste, null);
  assert.equal(valoresDaReserva([hig], "cartao", 12, 5).parcelas, 6, "no máximo o do orçamento");

  const comDesconto = valoresDaReserva(
    [{ ...hig, desconto: 83.97, total: 755.73, pix: 717.94 }],
    "cartao",
    null,
    5,
  );
  assert.equal(comDesconto.total, 755.73);
  assert.match(comDesconto.motivoAjuste ?? "", /desconto do orçamento/);
});

const V: Vendedora[] = [
  { id: "a", nome: "Alice (IA)", email: null, emailLogin: null, ehIa: true, comissao: 3 },
  {
    id: "m",
    nome: "Maria",
    email: null,
    emailLogin: "germanom744@gmail.com",
    ehIa: false,
    comissao: 3,
  },
  {
    id: "c",
    nome: "Carol",
    email: null,
    emailLogin: "anacarolinaveras26@gmail.com",
    ehIa: false,
    comissao: 3,
  },
];

test("casar vendedora pelo e-mail ou pelo primeiro nome", () => {
  assert.equal(casarVendedora({ nome: "Maria Germano", email: "atendimento@x.com" }, V)?.id, "m");
  assert.equal(casarVendedora({ email: "ANACAROLINAVERAS26@gmail.com" }, V)?.id, "c");
  assert.equal(casarVendedora({ nome: "Alice" }, V), null, "nunca a IA");
  assert.equal(casarVendedora({ nome: "Joana" }, V), null);
});

test("vendedora: Alice sozinha; atendente que participou; celular sem saber quem", () => {
  const base = { assumiu: false, responsavel: null, vendedoraDoLead: "a", vendedoras: V };
  const so = escolherVendedora({ ...base, participacoes: [] });
  assert.equal(so.vendedora?.id, "a");
  assert.equal(so.sozinha, true);

  const pelaMaria = escolherVendedora({
    ...base,
    participacoes: [
      { nome: "Carol", email: null, quando: "2026-10-07T10:00:00Z" },
      { nome: "Maria Germano", email: "atendimento@x.com", quando: "2026-10-07T11:00:00Z" },
    ],
  });
  assert.equal(pelaMaria.vendedora?.id, "m", "a mais recente");
  assert.equal(pelaMaria.sozinha, false);

  const celular = { nome: null, email: null, quando: "2026-10-07T11:00:00Z" };
  const responsavel = escolherVendedora({
    ...base,
    participacoes: [celular],
    responsavel: { nome: "Maria Germano" },
  });
  assert.equal(responsavel.vendedora?.id, "m");

  const doLead = escolherVendedora({ ...base, participacoes: [celular], vendedoraDoLead: "c" });
  assert.equal(doLead.vendedora?.id, "c");

  const semSaber = escolherVendedora({ ...base, participacoes: [celular] });
  assert.equal(semSaber.vendedora?.id, "a");
  assert.ok(semSaber.conferir);

  const assumiu = escolherVendedora({
    ...base,
    participacoes: [],
    assumiu: true,
    responsavel: { nome: "Carol" },
  });
  assert.equal(assumiu.vendedora?.id, "c");
});

test("eco automático: saudação até 10 s da primeira mensagem, ou texto já visto", () => {
  const vistas = new Set(["Olá! Já te respondemos."]);
  const base = {
    primeiraDoCliente: "2026-10-07T10:00:00Z",
    enviadaAntes: false,
    saudacoesVistas: vistas,
  };
  assert.equal(ecoAutomatico({ ...base, quando: "2026-10-07T10:00:06Z", texto: "Oi!" }), true);
  assert.equal(ecoAutomatico({ ...base, quando: "2026-10-07T10:02:00Z", texto: "Oi!" }), false);
  assert.equal(
    ecoAutomatico({ ...base, quando: "2026-10-08T10:00:00Z", texto: "Olá! Já te respondemos." }),
    true,
  );
  assert.equal(
    ecoAutomatico({ ...base, enviadaAntes: true, quando: "2026-10-07T10:00:03Z", texto: "Oi!" }),
    false,
  );
});

test("origem: a do lead; senão anúncio, indicação; só WhatsApp sem outra", () => {
  const opcoes = [
    { id: "g", nome: "Google", codigo: "google" },
    { id: "f", nome: "Facebook", codigo: "facebook" },
    { id: "i", nome: "Instagram", codigo: "instagram" },
    { id: "ind", nome: "Indicação", codigo: "indicacao" },
    { id: "camp", nome: "WhatsApp campanha", codigo: "whatsapp_campanha" },
  ];
  const sem = { gclid: null, gbraid: null, fbclid: null, utm_source: null };
  const base = { origemDoLead: null, cliques: [], indicado: false, opcoes };
  assert.equal(escolherOrigem({ ...base, origemDoLead: "camp" }).id, "camp");
  assert.equal(escolherOrigem({ ...base, cliques: [{ ...sem, gclid: "x" }] }).id, "g");
  assert.equal(escolherOrigem({ ...base, cliques: [{ ...sem, fbclid: "y" }] }).id, "f");
  assert.equal(escolherOrigem({ ...base, cliques: [{ ...sem, utm_source: "instagram" }] }).id, "i");
  assert.equal(escolherOrigem({ ...base, indicado: true }).id, "ind");
  const wpp = escolherOrigem(base);
  assert.equal(wpp.id, null, "ainda não existe: a reserva cria");
  assert.equal(wpp.nome, "WhatsApp");
});

test("aviso à equipe tem cliente, dia, horário e valor", () => {
  const a = avisoAgendamento({
    cliente: "Ana Souza",
    data: "2026-10-08",
    hora: "10:00:00",
    valores: { total: 1469.7, forma: "Crédito", parcelas: 3 },
    os: "1625",
    tecnico: "Josué Barreto",
    vendedora: "Alice (IA)",
    conferir: null,
  });
  assert.equal(a.titulo, "Agendamento feito pela Alice");
  assert.match(a.mensagem, /Ana Souza · qui 08\/10 às 10:00/);
  assert.match(a.mensagem, /3x/);
  assert.match(a.mensagem, /OS 1625/);
  assert.match(a.push, /Ana Souza · qui 08\/10 às 10:00 · R\$\s?1\.469,70/);
});
