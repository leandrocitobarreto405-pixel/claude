import { test } from "node:test";
import assert from "node:assert/strict";
import { passosDaConversa } from "./ensaio-custo.server";

test("ensaio de custo: a Alice responde no fim de cada sequência do cliente", () => {
  const h = [
    { de: "cliente" as const, texto: "oi" },
    { de: "alice" as const, texto: "olá" },
    { de: "cliente" as const, texto: "cep" },
    { de: "cliente" as const, texto: "[foto]" },
    { de: "alice" as const, texto: "recebi" },
    { de: "cliente" as const, texto: "ok" },
  ];
  assert.deepEqual(passosDaConversa(h), [1, 4, 6]);
});
