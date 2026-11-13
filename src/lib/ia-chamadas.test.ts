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

test("saldo sem dobro: a lista da função no banco é exatamente a das origens somadas em outra tabela", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { ORIGENS_CHAMADA, SOMADA_TAMBEM_EM } = await import("./ia-chamadas");
  const dir = "supabase/migrations";
  const ultima = readdirSync(dir)
    .filter((f) =>
      readFileSync(`${dir}/${f}`, "utf8").includes("FUNCTION private.ia_chamadas_custo_usd"),
    )
    .sort()
    .at(-1)!;
  const sql = readFileSync(`${dir}/${ultima}`, "utf8");
  const lista = /origem NOT IN \(([^)]*)\)/.exec(sql)?.[1] ?? "";
  const noBanco = [...lista.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
  const esperado = ORIGENS_CHAMADA.filter((o) => SOMADA_TAMBEM_EM[o]).sort();
  assert.deepEqual(noBanco, esperado);
  // O toque da equipe só existe em ia_chamadas (não entra em ia_execucoes nem em comercial_noites).
  assert.equal(SOMADA_TAMBEM_EM.toque_equipe, null);
});
