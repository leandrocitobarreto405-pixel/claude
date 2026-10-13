import { test } from "node:test";
import assert from "node:assert/strict";
import { colchaoComImper } from "./aviso-colchao";

test("aviso só para colchão com impermeabilização", () => {
  assert.equal(colchaoComImper(["Colchão casal — Impermeabilização"]), true);
  assert.equal(colchaoComImper(["Colchão king"], "Impermeabilização"), true);
  assert.equal(colchaoComImper(["Colchão casal — Higienização"], "Higienização"), false);
  assert.equal(colchaoComImper(["Sofá 3 lugares"], "Impermeabilização"), false);
});
