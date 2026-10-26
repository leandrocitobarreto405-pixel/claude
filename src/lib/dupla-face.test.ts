import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alternarDuplaFace,
  comDuplaFace,
  ehColchao,
  semDuplaFace,
  temDuplaFace,
} from "./dupla-face";
import {
  acrescimoDoItem,
  REGRAS_DESLIGADAS,
  regrasDaLinha,
  rotulosAcrescimo,
} from "./orcamento-regras";

test("nome do item com a marca de dupla face (orçamento e OS)", () => {
  assert.equal(
    comDuplaFace("Colchão queen", true),
    "Colchão queen – dupla face (2 faces + laterais)",
  );
  assert.equal(
    comDuplaFace("Colchão queen — Higienização", true),
    "Colchão queen – dupla face (2 faces + laterais) — Higienização",
  );
  const marcado = comDuplaFace("Colchão queen", true);
  assert.equal(comDuplaFace(marcado, true), marcado);
  assert.equal(semDuplaFace(marcado), "Colchão queen");
  assert.equal(temDuplaFace(marcado), true);
  assert.equal(comDuplaFace(marcado, false), "Colchão queen");
});

test("colchão pela categoria ou pelo nome", () => {
  assert.equal(ehColchao("colchao"), true);
  assert.equal(ehColchao("Colchão casal"), true);
  assert.equal(ehColchao("Sofá 3 lugares"), false);
  assert.equal(ehColchao(null), false);
});

test("regra da empresa: dupla face só conta ligada; desligada por padrão", () => {
  assert.equal(REGRAS_DESLIGADAS.duplaFace.ligada, false);
  assert.equal(acrescimoDoItem(REGRAS_DESLIGADAS, { duplaFace: true }), 0);
  const regras = regrasDaLinha({ dupla_face_ligada: true, dupla_face_pct: 20 });
  assert.equal(acrescimoDoItem(regras, { duplaFace: true }), 20);
  assert.equal(acrescimoDoItem(regras, { duplaFace: false }), 0);
  assert.deepEqual(rotulosAcrescimo(regras, { duplaFace: true }), ["dupla face +20%"]);
});

test("OS: ligar soma o acréscimo (real de cima) e desligar volta ao valor de antes", () => {
  const on = alternarDuplaFace(
    { descricao: "Colchão queen — Higienização", preco: 289.9 },
    20,
    true,
  );
  assert.equal(on.descricao, "Colchão queen – dupla face (2 faces + laterais) — Higienização");
  assert.equal(on.preco, 348);
  assert.equal(on.precoBase, 289.9);
  const off = alternarDuplaFace(
    { descricao: on.descricao, preco: on.preco, precoBase: on.precoBase },
    20,
    false,
  );
  assert.deepEqual(off, {
    descricao: "Colchão queen — Higienização",
    preco: 289.9,
    precoBase: null,
  });
  // Sem o valor de antes (OS salva): divide pelo acréscimo.
  assert.equal(alternarDuplaFace({ descricao: on.descricao, preco: 348 }, 20, false).preco, 290);
});
