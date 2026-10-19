// Gera src/lib/pdf/fontes.gerado.ts com as fontes do PDF em base64 (o servidor não lê arquivos
// do disco: o PDF é montado na memória). Rodar depois de trocar os .ttf de src/lib/pdf/fontes.
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL("../../src/lib/pdf/fontes/", import.meta.url);
const b64 = (n) => readFileSync(new URL(n, dir)).toString("base64");
writeFileSync(
  new URL("../fontes.gerado.ts", dir),
  `// Gerado por scripts/pdf/gerar-fontes.mjs: Plus Jakarta Sans (SIL OFL 1.1, ver fontes/OFL.txt).\n` +
    `export const FONTE_REGULAR = "${b64("PlusJakartaSans-Regular.ttf")}";\n` +
    `export const FONTE_NEGRITO = "${b64("PlusJakartaSans-Bold.ttf")}";\n`,
);
