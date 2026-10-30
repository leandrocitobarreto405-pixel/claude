import { test } from "node:test";
import assert from "node:assert/strict";
import { bancoLento, deveFrear, LIMITE_LENTO_MS } from "./freio.server";

const banco = (ms: number, erro = false) => ({
  from: () => ({
    select: () => ({
      limit: () =>
        new Promise((r) =>
          setTimeout(() => r(erro ? { error: { message: "x" } } : { data: [] }), ms),
        ),
    }),
  }),
});

test("freio: acima de 2 s ou com erro, para a passada", async () => {
  assert.equal(deveFrear(LIMITE_LENTO_MS), false);
  assert.equal(deveFrear(LIMITE_LENTO_MS + 1), true);
  assert.equal(deveFrear(10, true), true);
  assert.equal((await bancoLento(banco(5))).lento, false);
  assert.equal((await bancoLento(banco(5, true))).lento, true);
  const quebrado = {
    from: () => {
      throw new Error("sem conexão");
    },
  };
  assert.equal((await bancoLento(quebrado)).lento, true);
});
