import { test } from "node:test";
import assert from "node:assert/strict";
import { numeroForaDoVerde } from "./qualidade.server";

test("qualidade do número: só verde (ou sem nota) deixa disparar", () => {
  assert.equal(
    numeroForaDoVerde([{ display_phone_number: "+55 11 96807-0853", quality_rating: "GREEN" }]),
    null,
  );
  assert.equal(numeroForaDoVerde([{ quality_rating: "UNKNOWN" }]), null);
  assert.match(
    numeroForaDoVerde([{ display_phone_number: "+55 11 96807-0853", quality_rating: "YELLOW" }]) ??
      "",
    /\+55 11 96807-0853 está com qualidade amarela/,
  );
  assert.match(numeroForaDoVerde([{ quality_rating: "red" }]) ?? "", /vermelha/);
});
