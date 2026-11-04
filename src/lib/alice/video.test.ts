import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoDoVideo, pedidoSoTapeteOuPersiana as so } from "./video";

test("vídeo: só tapete ou persiana não recebe", () => {
  assert.equal(
    so({ textos: ["Quero um orçamento de limpeza de persianas."], categorias: [] }),
    true,
  );
  assert.equal(so({ textos: ["Tapete da sala 2x3"], categorias: [] }), true);
  assert.equal(so({ textos: ["oi"], categorias: ["tapete"] }), true);
  assert.equal(so({ textos: ["persiana e tapete"], categorias: ["persiana", "tapete"] }), true);
});

test("vídeo: pedido misto ou de estofado pode receber", () => {
  assert.equal(so({ textos: ["Tapete e sofá de 3 lugares"], categorias: [] }), false);
  assert.equal(so({ textos: ["persianas", "e dois colchões"], categorias: [] }), false);
  assert.equal(so({ textos: ["persianas"], categorias: ["persiana", "sofa"] }), false);
  assert.equal(so({ textos: ["Quero higienizar o SOFÁ"], categorias: [] }), false);
  assert.equal(so({ textos: ["6 cadeiras"], categorias: [] }), false);
  assert.equal(so({ textos: ["olá, bom dia"], categorias: [] }), false);
  assert.equal(so({ textos: [], categorias: [] }), false);
  assert.equal(so({ textos: [null, undefined], categorias: [null] }), false);
});

test("vídeo: acha o aviso do vídeo na resposta para tirar junto", () => {
  const saida = [
    { tipo: "texto", texto: "Anotei as persianas!" },
    { tipo: "texto", texto: "Enquanto preparo o orçamento, vou te mandar um vídeo curtinho" },
  ];
  assert.equal(avisoDoVideo(saida), 1);
  assert.equal(avisoDoVideo([{ tipo: "texto", texto: "oi" }]), -1);
  assert.equal(avisoDoVideo([{ tipo: "anexo" }]), -1);
});
