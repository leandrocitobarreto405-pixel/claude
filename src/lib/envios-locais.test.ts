import { test } from "node:test";
import assert from "node:assert/strict";
import { casarEnvios, type EnvioLocal } from "./envios-locais";

const base = (p: Partial<EnvioLocal>): EnvioLocal => ({
  id: "l1",
  conversaId: "c1",
  tipo: "audio",
  nome: "gravacao.m4a",
  url: "blob:x",
  em: "2026-10-21T12:00:00Z",
  estado: "enviando",
  ...p,
});

test("balão otimista: casa com a mensagem do servidor pelo id do Chatwoot", () => {
  const locais = [
    base({ id: "a", estado: "enviada", chatwootId: 10 }),
    base({ id: "b", estado: "enviada", chatwootId: 11 }),
    base({ id: "c", estado: "enviando" }),
    base({ id: "d", estado: "falhou", erro: "WhatsApp não aceitou" }),
  ];
  const { porChatwootId, soltos } = casarEnvios(locais, [10, null, undefined, 99]);
  assert.deepEqual([...porChatwootId.keys()], [10]);
  assert.deepEqual(
    soltos.map((e) => e.id),
    ["b", "c", "d"],
    "confirmada mas ainda fora da lista do servidor continua como balão próprio",
  );
});
