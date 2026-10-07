import * as XLSX from "xlsx";

/** Data de uma célula de planilha (número do Excel, "dd/mm/aaaa" ou "aaaa-mm-dd") em AAAA-MM-DD. */
export function dataPlanilha(v: unknown): string | null {
  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` : null;
  }
  const t = String(v ?? "").trim();
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const ano = br[3]!.length === 2 ? `20${br[3]}` : br[3]!;
    return `${ano}-${br[2]!.padStart(2, "0")}-${br[1]!.padStart(2, "0")}`;
  }
  return t.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}
