/**
 * Cupons de desconto (tabela `cupons`, por empresa): valor em reais para um serviço. A Alice
 * informa só o código; o sistema confere o serviço, oferece o cupom do mesmo canal quando o
 * serviço é o outro e escolhe o maior entre cupom e desconto de campanha/indicação (um só por
 * orçamento). Funções puras (ferramenta e testes).
 */
import type { Servico } from "./orcamento-alice";

export type Cupom = {
  codigo: string;
  valor: number;
  servico: Servico;
  canal: string | null;
};

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
  const reais = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
  return {
    ok: false,
    alternativa,
    texto:
      `O cupom ${cupom.codigo} vale só para ${NOME_SERVICO[cupom.servico]} (${reais(cupom.valor)}).` +
      (alternativa
        ? ` Para ${NOME_SERVICO[servico]}, o cupom do mesmo canal é ${alternativa.codigo} (${reais(alternativa.valor)}): explique ao cliente e refaça o orçamento com cupom "${alternativa.codigo}".`
        : ` Não há cupom de ${NOME_SERVICO[servico]} desse canal: explique ao cliente e refaça sem cupom.`),
  };
}

/** Um desconto por orçamento: o maior entre o cupom e o percentual (campanha/indicação). */
export function maiorDesconto(
  base: number,
  cupom: Cupom | null,
  pct: { pct: number; rotulo: string } | null,
): { tipo: "cupom"; cupom: Cupom } | { tipo: "pct"; pct: { pct: number; rotulo: string } } | null {
  const valorCupom = cupom ? Math.min(cupom.valor, base) : 0;
  const valorPct = pct ? Math.round(((base * pct.pct) / 100) * 100) / 100 : 0;
  if (!cupom && !pct) return null;
  if (cupom && valorCupom >= valorPct) return { tipo: "cupom", cupom };
  return pct ? { tipo: "pct", pct } : null;
}
