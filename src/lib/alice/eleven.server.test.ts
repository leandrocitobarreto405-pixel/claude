// Vozes da ElevenLabs em português do Brasil (filtro da lista da conta). Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { vozesPtBr } from "./eleven.server";

test("vozes: só português do Brasil, em ordem, com a prévia", () => {
  const r = vozesPtBr([
    {
      voice_id: "BQzELs93jJsUOf5rCb9p",
      name: "Voz Profissional Vanessa",
      labels: { language: "pt", accent: "pt-brazilian" },
      preview_url: "https://exemplo.test/v.mp3",
    },
    {
      voice_id: "AAAAAAAAAAAAAAAAAAAA",
      name: "Portugal",
      labels: { language: "pt", accent: "european" },
    },
    { voice_id: "BBBBBBBBBBBBBBBBBBBB", name: "Inglês", labels: { language: "en" } },
    {
      voice_id: "CCCCCCCCCCCCCCCCCCCC",
      name: "Ana",
      verified_languages: [{ language: "pt", locale: "pt-BR" }],
    },
  ]);
  assert.deepEqual(
    r.map((v) => v.nome),
    ["Ana", "Voz Profissional Vanessa"],
  );
  assert.equal(r[1]!.previa, "https://exemplo.test/v.mp3");
});
