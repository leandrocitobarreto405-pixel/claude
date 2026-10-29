import { test } from "node:test";
import assert from "node:assert/strict";
import { ficaEscuro } from "./tema";

test("Claro e Escuro valem sempre; Automático segue o aparelho", () => {
  assert.equal(ficaEscuro("claro", true), false);
  assert.equal(ficaEscuro("escuro", false), true);
  assert.equal(ficaEscuro("automatico", true), true);
  assert.equal(ficaEscuro("automatico", false), false);
});
