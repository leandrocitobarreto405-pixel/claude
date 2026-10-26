import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lerUso,
  nivelFranquia,
  percentualUsado,
  textoDepoisDaFranquia,
  textoMedidor,
} from "./franquia";

const uso = (extra: Record<string, unknown> = {}) =>
  lerUso({
    mes: "2026-10-01",
    usadas: 120,
    franquia: 150,
    trava: true,
    preco_excedente: "3.50",
    excedentes: 0,
    valor_excedente: "0",
    ...extra,
  })!;

test("medidor: X de 150 conversas e percentual", () => {
  assert.equal(textoMedidor(uso()), "Alice: 120 de 150 conversas este mês");
  assert.equal(percentualUsado(uso()), 80);
  assert.equal(percentualUsado(uso({ usadas: 200 })), 100);
  assert.equal(textoMedidor(uso({ franquia: null, usadas: 1 })), "Alice: 1 conversa este mês");
  assert.equal(percentualUsado(uso({ franquia: null })), null);
});

test("nível: atenção em 80%, esgotada em 100%", () => {
  assert.equal(nivelFranquia(uso({ usadas: 119 })), "normal");
  assert.equal(nivelFranquia(uso({ usadas: 120 })), "atencao");
  assert.equal(nivelFranquia(uso({ usadas: 150 })), "esgotada");
});

test("depois da franquia: para, segue até o teto, ou só mede", () => {
  assert.match(
    textoDepoisDaFranquia(uso(), false, null),
    /a Alice para e as conversas novas vão para a equipe/,
  );
  assert.match(
    textoDepoisDaFranquia(uso(), true, 70),
    /segue até R\$\s?70,00 de excedente no mês \(R\$\s?3,50 por conversa, na próxima fatura\)/,
  );
  assert.match(textoDepoisDaFranquia(uso({ trava: false }), false, null), /só acompanhamento/);
  assert.equal(lerUso(null), null);
});
