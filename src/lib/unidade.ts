/**
 * Unidade de cobrança dos itens: por peça ("un") ou por metro quadrado ("m2", tapete). Funções
 * puras para orçamento, OS, documento, mensagem do WhatsApp e Alice.
 */

export type Unidade = "un" | "m2";

/** Categorias cobradas por m². */
const CATEGORIAS_M2 = ["tapete"];
/** Categorias de limpeza (não "higienização") e fora das regras de item adicional. */
const CATEGORIAS_LIMPEZA = ["tapete", "persiana"];

export function unidadeDaCategoria(categoria: string | null | undefined): Unidade {
  return categoria && CATEGORIAS_M2.includes(categoria) ? "m2" : "un";
}

/** Tapete e persiana: serviço de limpeza, sem desconto de item adicional nem adicional pós-fechamento. */
export function categoriaDeLimpeza(categoria: string | null | undefined): boolean {
  return Boolean(categoria && CATEGORIAS_LIMPEZA.includes(categoria));
}

/** m²: até 2 casas decimais (mínimo 0,01); peça: inteiro a partir de 1. */
export function normalizarQuantidade(q: unknown, unidade: Unidade): number {
  const n = Number(q);
  if (unidade === "m2") {
    const v = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
    return v > 0 ? v : 1;
  }
  return Math.max(1, Math.round(Number.isFinite(n) && n > 0 ? n : 1));
}

const numeroBR = (n: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);

/** "3,68 m²" ou "2x" (peça). */
export function textoQuantidade(q: number, unidade: Unidade | string | null | undefined): string {
  return unidade === "m2" ? `${numeroBR(q)} m²` : `${numeroBR(q)}x`;
}

/**
 * Lê a quantidade digitada: "3,68", "3.68" ou as medidas "1,6 x 2,3" (comprimento × largura,
 * vira 3,68). Devolve null se não der para ler.
 */
export function lerQuantidade(texto: string): number | null {
  const t = texto.trim().toLowerCase().replace(/m²|m2/g, "");
  const partes = t.split(/[x×*]/).map((p) => Number(p.trim().replace(",", ".")));
  if (!partes.length || partes.some((p) => !Number.isFinite(p) || p <= 0)) return null;
  return Math.round(partes.reduce((a, b) => a * b, 1) * 100) / 100;
}

/** Nome do serviço: tapete e persiana são "Limpeza"; o resto, higienização/impermeabilização. */
export function rotuloServico(
  tipo: "higienizacao" | "impermeabilizacao" | string,
  categoria: string | null | undefined,
): string {
  if (tipo === "impermeabilizacao") return "Impermeabilização";
  return categoriaDeLimpeza(categoria) ? "Limpeza" : "Higienização";
}
