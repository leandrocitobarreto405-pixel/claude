import { test } from "node:test";
import assert from "node:assert/strict";
import { TRECHO_TECIDO, aplicarRoteiroTecido } from "./tecido-roteiro";

const linha = (fim: string) =>
  `- Tecido: pergunte o tecido (ou veja pela foto). Poliéster e tecidos comuns: classe B (padrão). ${fim}`;

test("roteiro do tecido: troca só a última frase da linha", () => {
  const novo = aplicarRoteiroTecido(`antes\n${linha(TRECHO_TECIDO.antes)}\ndepois`);
  assert.equal(novo, `antes\n${linha(TRECHO_TECIDO.depois)}\ndepois`);
  assert.doesNotMatch(novo, /confirmar tecido/);
});

test("roteiro do tecido: sem o trecho (ou repetido), não altera nada", () => {
  assert.throws(() => aplicarRoteiroTecido("roteiro sem a linha"), /aparece 0 vez/);
  assert.throws(
    () => aplicarRoteiroTecido(`${TRECHO_TECIDO.antes}\n${TRECHO_TECIDO.antes}`),
    /aparece 2 vez/,
  );
});
