import { test } from "node:test";
import assert from "node:assert/strict";
import { cabeNoHorario, duracaoDoAtendimento, precoUpsell } from "./upsell";

test("preço do upsell: tabela − desconto, terminando em ,90 para baixo", () => {
  assert.equal(precoUpsell(249.9, 20), 199.9);
  assert.equal(precoUpsell(389.9, 20), 311.9);
  assert.equal(precoUpsell(150, 20), 119.9);
});

test("duração de referência: sofá 3 h, colchão 1h30, cadeira 15 min cada", () => {
  assert.equal(
    duracaoDoAtendimento([
      { descricao: "Sofá 3 lugares — Higienização", quantidade: 1 },
      { descricao: "Colchão queen", quantidade: 1 },
      { descricao: "Cadeira (assento)", quantidade: 6 },
    ]),
    180 + 90 + 90,
  );
});

test("cabe antes do próximo serviço do técnico no dia", () => {
  assert.deepEqual(cabeNoHorario("08:00", 270, "14:00").cabe, true);
  const r = cabeNoHorario("11:00", 270, "14:00");
  assert.equal(r.cabe, false);
  assert.match(r.texto, /15h30.*14h/);
  assert.equal(cabeNoHorario("14:00", 400, null).cabe, true);
});
