/**
 * Classificação do lead (12/11): no lugar da temperatura (Quente/Morno/Frio), as telas mostram a
 * classificação que a Tatiana dá na leitura da noite ("Em negociação", "Achou caro", "Sumiu depois
 * do orçamento"…). Lead que a Tatiana ainda não leu fica sem selo. Regras puras.
 */
import { CAIXINHAS, type Caixinha } from "@/lib/comercial/tatiana";

export function ehCaixinha(n: number | null | undefined): n is Caixinha {
  return typeof n === "number" && n in CAIXINHAS;
}

export function rotuloClassificacao(n: number | null | undefined): string | null {
  return ehCaixinha(n) ? CAIXINHAS[n] : null;
}

export type TomClassificacao = "danger" | "warning" | "navy" | "teal" | "success" | "neutral";

/** Cor do selo: negociação chama atenção; achou caro e sumiu pedem ação; o resto é discreto. */
export function tomClassificacao(n: number | null | undefined): TomClassificacao {
  switch (n) {
    case 2:
      return "danger";
    case 4:
      return "warning";
    case 3:
      return "navy";
    case 5:
      return "teal";
    case 1:
      return "success";
    default:
      return "neutral";
  }
}

/** Opções do filtro da lista de leads. */
export const OPCOES_CLASSIFICACAO = (Object.keys(CAIXINHAS) as unknown as string[]).map((k) => ({
  value: String(k),
  label: CAIXINHAS[Number(k) as Caixinha],
}));
