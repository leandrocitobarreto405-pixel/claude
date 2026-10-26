/**
 * Cupons de desconto (tabela `cupons`, por empresa): valor em reais ou percentual, para um serviço,
 * com validade opcional (Configurações › Vendas › Cupons). A Alice
 * informa só o código; o sistema confere o serviço, oferece o cupom do mesmo canal quando o
 * serviço é o outro e escolhe o maior entre cupom e desconto de campanha/indicação (um só por
 * orçamento). Funções puras (ferramenta e testes).
 */
import type { Servico } from "./orcamento-alice";

export type Cupom = {
  codigo: string;
  /** Desconto em reais (ou null quando o cupom é em percentual). */
  valor: number | null;
  /** Desconto em percentual (ou null quando o cupom é em reais). */
  percentual?: number | null;
  servico: Servico;
  canal: string | null;
};

/** Desconto do cupom sobre a base (nunca maior que ela). */
export function valorDoCupom(c: Pick<Cupom, "valor" | "percentual">, base: number): number {
  const bruto = c.percentual ? (base * c.percentual) / 100 : (c.valor ?? 0);
  return Math.round(Math.min(Math.max(bruto, 0), base) * 100) / 100;
}

/** "R$ 50,00" ou "10%". */
export function rotuloCupom(c: Pick<Cupom, "valor" | "percentual">): string {
  if (c.percentual) return `${c.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  return (c.valor ?? 0)
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    .replace(/\u00a0/g, " ");
}

/** Cupom vale hoje? (sem data = sem prazo; a data é o último dia) */
export function cupomNoPrazo(validoAte: string | null | undefined, hoje: string): boolean {
  return !validoAte || validoAte >= hoje;
}

export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Primeiro cupom cadastrado citado no texto (ex.: "Vi o cupom BLOG50 no blog"). */
export function cupomNoTexto(texto: string | null | undefined, cupons: Cupom[]): Cupom | null {
  if (!texto) return null;
  const palavras = new Set(
    texto
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter(Boolean),
  );
  return cupons.find((c) => palavras.has(c.codigo)) ?? null;
}

export const NOME_SERVICO: Record<Servico, string> = {
  higienizacao: "higienização",
  impermeabilizacao: "impermeabilização",
};

export type CupomEscolhido =
  { ok: true; cupom: Cupom } | { ok: false; texto: string; alternativa: Cupom | null };

/** Confere o código e o serviço; no serviço errado, indica o cupom do mesmo canal. */
export function conferirCupom(codigo: string, servico: Servico, cupons: Cupom[]): CupomEscolhido {
  const cod = normalizarCodigo(codigo);
  const cupom = cupons.find((c) => c.codigo === cod);
  if (!cupom)
    return {
      ok: false,
      alternativa: null,
      texto: `O cupom ${cod || codigo} não existe ou não está ativo. Diga ao cliente que não encontrou esse cupom e refaça o orçamento sem cupom (não transfira só por isso).`,
    };
  if (cupom.servico === servico) return { ok: true, cupom };
  const alternativa =
    cupons.find((c) => c.servico === servico && c.canal && c.canal === cupom.canal) ?? null;
  return {
    ok: false,
    alternativa,
    texto:
      `O cupom ${cupom.codigo} vale só para ${NOME_SERVICO[cupom.servico]} (${rotuloCupom(cupom)}).` +
      (alternativa
        ? ` Para ${NOME_SERVICO[servico]}, o cupom do mesmo canal é ${alternativa.codigo} (${rotuloCupom(alternativa)}): explique ao cliente e refaça o orçamento com cupom "${alternativa.codigo}".`
        : ` Não há cupom de ${NOME_SERVICO[servico]} desse canal: explique ao cliente e refaça sem cupom.`),
  };
}

/** Um desconto por orçamento: o maior entre o cupom e o percentual (campanha/indicação). */
export function maiorDesconto(
  base: number,
  cupom: Cupom | null,
  pct: { pct: number; rotulo: string } | null,
): { tipo: "cupom"; cupom: Cupom } | { tipo: "pct"; pct: { pct: number; rotulo: string } } | null {
  const valorCupom = cupom ? valorDoCupom(cupom, base) : 0;
  const valorPct = pct ? Math.round(((base * pct.pct) / 100) * 100) / 100 : 0;
  if (!cupom && !pct) return null;
  if (cupom && valorCupom >= valorPct) return { tipo: "cupom", cupom };
  return pct ? { tipo: "pct", pct } : null;
}
