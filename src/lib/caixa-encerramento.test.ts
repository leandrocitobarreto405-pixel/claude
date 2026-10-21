import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configEncerramento,
  limiteParada,
  paraSalvar,
  situacoesAlcancadas,
} from "./caixa-encerramento";

test("encerramento automático começa desligado, 24 h, só equipe", () => {
  assert.deepEqual(configEncerramento(null), { ligado: false, horas: 24, incluirAlice: false });
  assert.deepEqual(configEncerramento({ encerramento_horas: 0 }).horas, 24);
  assert.deepEqual(configEncerramento({ encerramento_horas: 9999 }).horas, 24);
  const c = configEncerramento({
    encerramento_automatico: true,
    encerramento_horas: "48",
    encerramento_inclui_alice: true,
  });
  assert.deepEqual(c, { ligado: true, horas: 48, incluirAlice: true });
  assert.deepEqual(situacoesAlcancadas(c), ["open", "pending"]);
  assert.deepEqual(situacoesAlcancadas({ ...c, incluirAlice: false }), ["open"]);
  assert.equal(limiteParada(c, new Date("2026-10-21T12:00:00Z")), "2026-10-19T12:00:00.000Z");
  assert.deepEqual(paraSalvar(c), {
    encerramento_automatico: true,
    encerramento_horas: 48,
    encerramento_inclui_alice: true,
  });
});
