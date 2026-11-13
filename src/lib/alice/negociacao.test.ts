import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avisoDaVolta,
  calcularPedido,
  fraseDeEspera,
  fraseDeNegado,
  parametrosDaConfig,
  proximoPasso,
  textoDoPush,
} from "./negociacao";

const p = parametrosDaConfig({});
const nbsp = (s: string) => s.replace(/\u00a0/g, " ");

test("parâmetros: padrões da migração e chave desligada", () => {
  assert.deepEqual(p, { ligada: false, tetoPct: 12, tetoPixPct: 15, esperaMin: 10, voltaMin: 4 });
  assert.equal(
    parametrosDaConfig({ negociacao_ligada: true, negociacao_teto_pct: 99 }).tetoPct,
    12,
  );
});

test("sem concorrente: sugere o teto de 12% do valor cheio, em reais inteiros", () => {
  const r = calcularPedido(
    { valorCheio: 600, descontoAtual: 0, temCupom: false, concorrente: null, foraDoHorario: false },
    p,
  );
  assert.equal(r.valorSugerido, 528);
  assert.equal(r.descontoPct, 12);
  assert.equal(r.segueSozinha, true);
  assert.equal(r.valorPixMinimo, 510);
  // Com cupom de R$ 50: o teto é sobre o valor cheio (12% no total), e a Alice nunca segue sozinha.
  const c = calcularPedido(
    { valorCheio: 600, descontoAtual: 50, temCupom: true, concorrente: null, foraDoHorario: false },
    p,
  );
  assert.equal(c.valorSugerido, 528);
  assert.equal(c.segueSozinha, false);
});

test("concorrente: dentro do teto iguala; abaixo do teto sugere 12% e mostra quanto falta", () => {
  const dentro = calcularPedido(
    { valorCheio: 600, descontoAtual: 0, temCupom: false, concorrente: 550, foraDoHorario: false },
    p,
  );
  assert.equal(dentro.valorSugerido, 550);
  assert.equal(dentro.faltaParaIgualar, null);
  assert.equal(dentro.acimaDoTeto, false);
  const abaixo = calcularPedido(
    { valorCheio: 600, descontoAtual: 0, temCupom: false, concorrente: 450, foraDoHorario: false },
    p,
  );
  assert.equal(abaixo.valorSugerido, 528);
  assert.equal(abaixo.faltaParaIgualar, 78);
  assert.equal(abaixo.acimaDoTeto, true);
  assert.equal(abaixo.segueSozinha, true);
  // De noite, passando do teto: espera o gestor de manhã.
  const noite = calcularPedido(
    { valorCheio: 600, descontoAtual: 0, temCupom: false, concorrente: 450, foraDoHorario: true },
    p,
  );
  assert.equal(noite.segueSozinha, false);
  // Concorrente acima do nosso valor atual: não sobe o preço.
  const caro = calcularPedido(
    { valorCheio: 600, descontoAtual: 0, temCupom: false, concorrente: 700, foraDoHorario: false },
    p,
  );
  assert.equal(caro.valorSugerido, 600);
});

test("orçamento já no teto (ex.: combo 10% + Pix): nada para a Alice dar sozinha", () => {
  const r = calcularPedido(
    {
      valorCheio: 1000,
      descontoAtual: 130,
      temCupom: false,
      concorrente: null,
      foraDoHorario: false,
    },
    p,
  );
  assert.equal(r.jaNoTeto, true);
  assert.equal(r.valorSugerido, 870);
  assert.equal(r.segueSozinha, false);
});

test("frases aprovadas", () => {
  assert.equal(
    fraseDeEspera({ nome: "Ana", noite: false }),
    "Me dá uns minutinhos que eu já volto com a resposta, tá bom? 💙",
  );
  assert.equal(
    fraseDeEspera({ nome: "Ana", noite: true }),
    "Já deixei seu pedido com o meu gestor, Ana. Amanhã logo cedo eu te confirmo o valor, tá bom? 💙",
  );
  assert.equal(
    nbsp(fraseDeNegado({ nome: "Ana", valor: 600 })),
    "Falei com o meu gestor e não consegui baixar mais, Ana. O que eu consigo é manter os R$ 600,00 e já reservar o seu horário. Quer que eu reserve?",
  );
});

test("próximo passo: espera, segue sozinha no prazo, volta ao cliente depois do mínimo", () => {
  const base = {
    situacao: "pendente" as const,
    criadoEm: "2026-11-12T17:00:00Z",
    prazoEm: "2026-11-12T17:10:00Z",
    voltarApos: "2026-11-12T17:04:00Z",
    segueSozinha: true,
    respondidoEm: null,
    clienteAvisadoEm: null,
  };
  assert.equal(proximoPasso(base, new Date("2026-11-12T17:05:00Z")), "esperar");
  assert.equal(proximoPasso(base, new Date("2026-11-12T17:10:00Z")), "seguir_sozinha");
  assert.equal(
    proximoPasso({ ...base, segueSozinha: false }, new Date("2026-11-12T18:00:00Z")),
    "esperar",
  );
  const autorizado = {
    ...base,
    situacao: "autorizado" as const,
    respondidoEm: "2026-11-12T17:01:00Z",
  };
  assert.equal(proximoPasso(autorizado, new Date("2026-11-12T17:02:00Z")), "esperar");
  assert.equal(proximoPasso(autorizado, new Date("2026-11-12T17:04:00Z")), "avisar_cliente");
  assert.equal(
    proximoPasso({ ...autorizado, clienteAvisadoEm: "2026-11-12T17:04:00Z" }, new Date()),
    "nada",
  );
  assert.equal(proximoPasso({ ...base, situacao: "assumido" }, new Date()), "nada");
});

test("aviso da volta e push", () => {
  const ok = nbsp(
    avisoDaVolta({
      situacao: "autorizado",
      valorFinal: 528,
      valorAtual: 600,
      valorCheio: 600,
      nome: "Ana",
      acimaDoTeto: false,
      combo: false,
    }),
  );
  assert.match(ok, /valor liberado é R\$ 528,00 \(desconto total de 12% sobre o valor cheio\)/);
  assert.match(ok, /desconto "negociacao"/);
  assert.match(ok, /Consegui liberar! 🎉 Ficou R\$ 528,00\. Tenho duas vagas/);
  const auto = avisoDaVolta({
    situacao: "automatico",
    valorFinal: 528,
    valorAtual: 600,
    valorCheio: 600,
    nome: "Ana",
    acimaDoTeto: true,
    combo: true,
  });
  assert.match(nbsp(auto), /Consegui chegar em R\$ 528,00! 🎉/);
  assert.match(auto, /combo true/);
  const nao = avisoDaVolta({
    situacao: "negado",
    valorFinal: null,
    valorAtual: 600,
    valorCheio: 600,
    nome: "Ana",
    acimaDoTeto: false,
    combo: false,
  });
  assert.match(nao, /NÃO liberou/);
  assert.match(nbsp(nao), /manter os R\$ 600,00/);
  assert.deepEqual(
    textoDoPush({
      nome: "Carlos",
      final: "2210",
      valorCheio: 650,
      valorAtual: 600,
      sugerido: 572,
      pct: 12,
      concorrente: 500,
      cupom: 50,
      minutos: 5,
    }).titulo,
    "💰 Autorizar desconto: Carlos (final 2210)",
  );
});
