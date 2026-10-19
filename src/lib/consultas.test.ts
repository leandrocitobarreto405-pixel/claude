// Nenhum embutido de visits sem dizer a chave (visits e work_orders têm três relações; o
// PostgREST recusa e a tela zera). Varre o código do app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && !n.endsWith(".gen.ts") ? [p] : [];
  });
}

test("todo embutido de visits indica a chave (visits!..._fkey)", () => {
  const raiz = join(import.meta.dirname, "..");
  const achados: string[] = [];
  for (const arq of arquivos(raiz)) {
    if (arq.includes("integrations/supabase/types")) continue;
    readFileSync(arq, "utf8")
      .split("\n")
      .forEach((linha, i) => {
        if (/(^|[\s,(":])visits\s*\(/.test(linha)) achados.push(`${arq}:${i + 1}: ${linha.trim()}`);
      });
  }
  assert.deepEqual(achados, []);
});
