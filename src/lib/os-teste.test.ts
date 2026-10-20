// OS de teste fora das listas (ex.: a OS 1682, de teste, aparecia em "Para concluir").
import { test } from "node:test";
import assert from "node:assert/strict";
import { semOsDeTeste } from "./os-teste";

test("visita de OS de teste sai da lista; as outras ficam", () => {
  const lista = [
    { id: "a", work_order: { eh_teste: true } },
    { id: "b", work_order: { eh_teste: false } },
    { id: "c", work_order: null },
  ];
  assert.deepEqual(
    lista.filter(semOsDeTeste).map((v) => v.id),
    ["b", "c"],
  );
});
