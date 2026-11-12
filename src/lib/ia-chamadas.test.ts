import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELO_FICHA, MODELO_HAIKU, PRECO_HAIKU, PRECO_SONNET } from "@/lib/comercial/ficha";
import { PRECO_HAIKU_45, linhaDaChamada, precoDoModelo } from "./ia-chamadas";

test("preço por modelo: Haiku 5.5, Haiku 4.5 e o resto no Sonnet", () => {
  assert.equal(precoDoModelo(MODELO_HAIKU), PRECO_HAIKU);
  assert.equal(precoDoModelo("claude-haiku-4-5"), PRECO_HAIKU_45);
  assert.equal(precoDoModelo(MODELO_FICHA), PRECO_SONNET);
});

test("linha da chamada: custo pelo uso; falha fica sem custo e ok = false", () => {
  const l = linhaDaChamada({
    empresaId: "e1",
    origem: "classificador_toque",
    modelo: MODELO_HAIKU,
    uso: { input_tokens: 2_000, output_tokens: 400 },
    referencia: "conversa-1",
  });
  assert.equal(l.ok, true);
  assert.equal(l.tokens_entrada, 2_000);
  assert.equal(l.tokens_saida, 400);
  assert.equal(
    l.custo_usd,
    Math.round(((2_000 * PRECO_HAIKU.entrada + 400 * PRECO_HAIKU.saida) / 1_000_000) * 100_000) /
      100_000,
  );
  const f = linhaDaChamada({
    empresaId: "e1",
    origem: "retorno_combinado",
    modelo: "claude-haiku-4-5",
    uso: null,
  });
  assert.equal(f.ok, false);
  assert.equal(f.custo_usd, 0);
  assert.equal(f.referencia, null);
  // Referência longa é cortada (cabe na coluna).
  assert.equal(
    linhaDaChamada({
      ...l,
      empresaId: "e1",
      origem: "toque_equipe",
      uso: null,
      referencia: "x".repeat(200),
    }).referencia!.length,
    80,
  );
});
