import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filtrarItens,
  haQuanto,
  ordenarItens,
  resumoDoDia,
  type ItemPrecisa,
} from "./precisa-de-voce";

const item = (p: Partial<ItemPrecisa> & Pick<ItemPrecisa, "chave" | "secao">): ItemPrecisa => ({
  nome: "Cliente",
  detalhe: "",
  quando: null,
  conversaId: null,
  leadId: null,
  donoUserId: null,
  ...p,
});

test("ordem: urgente, esperando, lead do site, follow-up; o mais antigo primeiro", () => {
  const r = ordenarItens([
    item({ chave: "f", secao: "followup", quando: "2026-10-27T13:00:00Z" }),
    item({ chave: "e2", secao: "esperando", quando: "2026-10-27T12:10:00Z" }),
    item({ chave: "u", secao: "urgente", quando: "2026-10-27T12:30:00Z" }),
    item({ chave: "e1", secao: "esperando", quando: "2026-10-27T12:00:00Z" }),
    item({ chave: "l", secao: "lead_site", quando: "2026-10-26T12:00:00Z" }),
  ]);
  assert.deepEqual(
    r.map((i) => i.chave),
    ["u", "e1", "e2", "l", "f"],
  );
});

test("filtro: os meus + sem dono; outra pessoa; todos", () => {
  const itens = [
    item({ chave: "a", secao: "esperando", donoUserId: "eu" }),
    item({ chave: "b", secao: "esperando", donoUserId: "carol" }),
    item({ chave: "c", secao: "esperando", donoUserId: null }),
  ];
  assert.deepEqual(
    filtrarItens(itens, "meus", "eu").map((i) => i.chave),
    ["a", "c"],
  );
  assert.deepEqual(
    filtrarItens(itens, "carol", "eu").map((i) => i.chave),
    ["b", "c"],
  );
  assert.equal(filtrarItens(itens, "todos", "eu").length, 3);
});

test("há quanto tempo", () => {
  const agora = new Date("2026-10-27T15:00:00Z");
  assert.equal(haQuanto("2026-10-27T14:46:00Z", agora), "há 14 min");
  assert.equal(haQuanto("2026-10-27T13:00:00Z", agora), "há 2 h");
  assert.equal(haQuanto("2026-10-26T15:00:00Z", agora), "há 1 dia");
});

test("resumo das 10h: só o que tem; lista zerada não avisa", () => {
  assert.equal(
    resumoDoDia(
      [
        item({ chave: "u", secao: "urgente" }),
        item({ chave: "e1", secao: "esperando" }),
        item({ chave: "e2", secao: "esperando" }),
      ],
      { quantidade: 18 },
    ),
    "Hoje: 1 urgente, 2 clientes esperando, 18 orçamentos sem desfecho.",
  );
  assert.equal(resumoDoDia([], { quantidade: 0 }), null);
});
