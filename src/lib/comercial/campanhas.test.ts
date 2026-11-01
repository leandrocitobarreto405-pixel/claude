import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classePeloSistema,
  janelaDaCampanha,
  numerosDaCampanha,
  resumoCurto,
  resumoDasClasses,
  type EnvioCampanha,
} from "./campanhas";

const envio = (p: Partial<EnvioCampanha> & { id: string }): EnvioCampanha => ({
  status: "enviado",
  enviadoEm: "2026-10-14T13:00:00.000Z",
  respondidoEm: null,
  botaoClicado: null,
  quoteId: null,
  workOrderId: null,
  valorVenda: null,
  bloqueio: false,
  optoutEm: null,
  ...p,
});

describe("campanhas: janela", () => {
  it("vai do primeiro envio até 7 dias depois", () => {
    const j = janelaDaCampanha([
      envio({ id: "a", enviadoEm: "2026-10-15T12:00:00.000Z" }),
      envio({ id: "b", enviadoEm: "2026-10-14T13:00:00.000Z" }),
      envio({ id: "c", status: "erro", enviadoEm: null }),
    ]);
    assert.deepEqual(j, { inicio: "2026-10-14T13:00:00.000Z", fim: "2026-10-21T13:00:00.000Z" });
  });
  it("sem envio não há janela", () => {
    assert.equal(janelaDaCampanha([envio({ id: "a", enviadoEm: null })]), null);
  });
});

describe("campanhas: números", () => {
  const fim = "2026-10-21T13:00:00.000Z";
  const envios = [
    envio({ id: "1", respondidoEm: "2026-10-14T14:00:00.000Z", quoteId: "q1" }),
    envio({
      id: "2",
      respondidoEm: "2026-10-15T14:00:00.000Z",
      workOrderId: "os",
      valorVenda: 450,
    }),
    // Resposta depois da janela não conta como resposta da campanha.
    envio({ id: "3", respondidoEm: "2026-10-25T14:00:00.000Z" }),
    envio({ id: "4", status: "erro", enviadoEm: null }),
    envio({ id: "5", optoutEm: "2026-10-16T10:00:00.000Z" }),
    // Descadastro antes do envio não é culpa desta campanha.
    envio({ id: "6", optoutEm: "2026-09-01T10:00:00.000Z" }),
    envio({ id: "7", bloqueio: true }),
  ];
  it("conta enviados, respostas na janela, orçamentos, vendas, custo e retorno", () => {
    const n = numerosDaCampanha(envios, 0.32, fim);
    assert.equal(n.enviados, 6);
    assert.equal(n.erros, 1);
    assert.equal(n.responderam, 2);
    assert.equal(n.orcamentos, 1);
    assert.equal(n.fecharam, 1);
    assert.equal(n.vendido, 450);
    assert.equal(n.custo, 1.92);
    assert.equal(n.retorno, 234.4);
    assert.equal(n.descadastros, 1);
    assert.equal(n.bloqueios, 1);
    assert.equal(n.pctResposta, 33.3);
    assert.equal(n.pctVenda, 16.7);
  });
  it("sem custo o retorno fica em branco", () => {
    assert.equal(numerosDaCampanha(envios, 0, fim).retorno, null);
    assert.equal(numerosDaCampanha([], 0.32, fim).pctResposta, null);
  });
  it("resumo curto", () => {
    assert.equal(
      resumoCurto(numerosDaCampanha(envios, 0.32, fim)),
      "6 enviados · 2 responderam · 1 pediram orçamento · 1 venda (R$ 450) · retorno 234,4x",
    );
  });
});

describe("campanhas: classe pelo sistema", () => {
  const botoes = { "quero meu orcamento": "interesse", "nao tenho interesse": "sem_interesse" };
  it("botão do modelo e descadastro não precisam de IA", () => {
    assert.equal(
      classePeloSistema(envio({ id: "a", botaoClicado: "quero meu orcamento" }), botoes),
      "interesse",
    );
    assert.equal(
      classePeloSistema(envio({ id: "b", botaoClicado: "nao tenho interesse" }), botoes),
      "sem_interesse",
    );
    assert.equal(
      classePeloSistema(envio({ id: "c", optoutEm: "2026-10-15T00:00:00.000Z" }), botoes),
      "descadastro",
    );
    assert.equal(classePeloSistema(envio({ id: "d", quoteId: "q" }), botoes), "interesse");
  });
  it("texto livre fica para a IA", () => {
    assert.equal(classePeloSistema(envio({ id: "e", respondidoEm: "x" }), botoes), null);
    assert.equal(classePeloSistema(envio({ id: "f", botaoClicado: "outro botão" }), botoes), null);
  });
  it("resumo das classes, mais comuns primeiro", () => {
    assert.deepEqual(
      resumoDasClasses({ a: "preco", b: "interesse", c: "preco", d: "descadastro" }),
      [
        { classe: "preco", nome: "Perguntou preço", n: 2 },
        { classe: "interesse", nome: "Interesse", n: 1 },
        { classe: "descadastro", nome: "Pediu para parar", n: 1 },
      ],
    );
  });
});
