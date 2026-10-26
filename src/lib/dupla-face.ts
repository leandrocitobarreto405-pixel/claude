/**
 * Colchão dupla face (26/10): a higienização de colchão inclui a face de cima e as laterais; quem
 * usa os dois lados paga a dupla face (acréscimo da empresa, em Regras de orçamento). A marca vai
 * no próprio nome do item ("Colchão queen – dupla face (2 faces + laterais)"), então o PDF, o
 * cartão do WhatsApp e a OS mostram o mesmo texto. Funções puras.
 */
import { precoComAcrescimo } from "./orcamento-regras";

export const SUFIXO_DUPLA_FACE = " – dupla face (2 faces + laterais)";

/** Item de colchão (pela categoria ou pelo nome/descrição). */
export function ehColchao(categoriaOuTexto: string | null | undefined): boolean {
  const t = categoriaOuTexto ?? "";
  return t === "colchao" || /colch[aã]o/i.test(t);
}

export function temDuplaFace(nome: string | null | undefined): boolean {
  return (nome ?? "").includes(SUFIXO_DUPLA_FACE);
}

/** Nome sem a marca de dupla face. */
export function semDuplaFace(nome: string): string {
  return nome.split(SUFIXO_DUPLA_FACE).join("");
}

/**
 * Nome com (ou sem) a marca. Na OS a descrição tem o serviço depois de " — "
 * ("Colchão queen — Higienização"): a marca entra antes dele.
 */
export function comDuplaFace(nome: string, marcado: boolean): string {
  const base = semDuplaFace(nome);
  if (!marcado) return base;
  const i = base.indexOf(" — ");
  return i < 0
    ? `${base}${SUFIXO_DUPLA_FACE}`
    : `${base.slice(0, i)}${SUFIXO_DUPLA_FACE}${base.slice(i)}`;
}

/**
 * Liga ou desliga a dupla face num item da OS: descrição com a marca e valor com o acréscimo
 * (arredondado para o real de cima, como no orçamento). Desligar volta ao valor sem acréscimo
 * (`precoBase` quando a tela guardou; senão, o valor dividido pelo acréscimo).
 */
export function alternarDuplaFace(
  item: { descricao: string; preco: number; precoBase?: number | null },
  pct: number,
  ligar: boolean,
): { descricao: string; preco: number; precoBase: number | null } {
  const marcado = temDuplaFace(item.descricao);
  if (ligar === marcado) {
    return { descricao: item.descricao, preco: item.preco, precoBase: item.precoBase ?? null };
  }
  if (ligar) {
    return {
      descricao: comDuplaFace(item.descricao, true),
      preco: precoComAcrescimo(item.preco, pct),
      precoBase: item.preco,
    };
  }
  const base = item.precoBase ?? Math.round((item.preco / (1 + pct / 100)) * 100) / 100;
  return { descricao: comDuplaFace(item.descricao, false), preco: base, precoBase: null };
}
