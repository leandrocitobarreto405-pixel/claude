/**
 * Número do orçamento (quotes.numero, sequencial por empresa): exibido com 4 dígitos ("0153").
 * Para buscar, aceita "153", "0153", "Nº 0153" e, de orçamentos antigos, o id curto ("3fa2b1c9").
 */

/** "0153" (acima de 9999 mostra todos os dígitos); sem número, o id curto antigo. */
export function formatarNumeroOrcamento(numero: number | null | undefined, id?: string): string {
  if (numero !== null && numero !== undefined && Number.isFinite(Number(numero)))
    return String(Math.trunc(Number(numero))).padStart(4, "0");
  return id ? String(id).slice(0, 8) : "";
}

/** O que foi digitado, se for um número de orçamento ("Nº 0153" → 153); senão null. */
export function lerNumeroOrcamento(texto: string | null | undefined): number | null {
  const t = String(texto ?? "")
    .trim()
    .replace(/^(n[º°o.]?|#)\s*/i, "")
    .trim();
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** Prefixo do id curto antigo (só hexadecimal), para orçamentos citados antes da numeração. */
export function prefixoIdOrcamento(texto: string | null | undefined): string {
  return String(texto ?? "")
    .replace(/[^0-9a-f-]/gi, "")
    .toLowerCase();
}

/**
 * Acha o orçamento pelo que foi digitado: primeiro o número novo; se não houver, o id curto
 * antigo ("0153" também é começo de id válido, por isso o número vem antes).
 */
export function acharOrcamento<T extends { id: string; numero?: number | null }>(
  lista: T[],
  texto: string,
): T | null {
  const n = lerNumeroOrcamento(texto);
  if (n !== null) {
    const porNumero = lista.find((q) => Number(q.numero) === n);
    if (porNumero) return porNumero;
  }
  const prefixo = prefixoIdOrcamento(texto);
  if (prefixo.length < 4) return null;
  return lista.find((q) => q.id.toLowerCase().startsWith(prefixo)) ?? null;
}
