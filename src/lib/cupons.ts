/**
 * Cupons da empresa (Configurações › Vendas › Cupons): código, desconto em reais OU percentual,
 * serviço, origem do lead, validade e ativo. A Alice e o orçamento manual leem a mesma tabela.
 * Sem apagar: cupom que não vale mais fica inativo (o histórico dos orçamentos continua).
 */
import { cupomNoPrazo, valorDoCupom } from "@/lib/alice/cupons";
import type { Servico } from "@/lib/alice/orcamento-alice";

export const CHAVE_CUPONS = ["cupons"] as const;

export type CupomTela = {
  id: string | null;
  codigo: string;
  tipo: "valor" | "percentual";
  /** Reais ou percentual, conforme o tipo. */
  quantia: number;
  servico: Servico;
  origemId: string | null;
  validoAte: string | null;
  ativo: boolean;
};

export type CupomDoOrcamento = {
  codigo: string;
  valor: number | null;
  percentual: number | null;
  servico: Servico;
  validoAte: string | null;
};

export const SERVICOS_CUPOM: { valor: Servico; rotulo: string }[] = [
  { valor: "higienizacao", rotulo: "Higienização" },
  { valor: "impermeabilizacao", rotulo: "Impermeabilização" },
];

/** "site 50" → "SITE50" (só letras e números, maiúsculas). */
export function limparCodigo(codigo: string): string {
  return codigo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

/** Confere e devolve a linha para gravar; erro em português para a tela. */
export function validarCupom(c: CupomTela): {
  codigo: string;
  valor: number | null;
  percentual: number | null;
  servico: Servico;
  origem_id: string | null;
  valido_ate: string | null;
  ativo: boolean;
} {
  const codigo = limparCodigo(c.codigo ?? "");
  if (codigo.length < 3 || codigo.length > 30)
    throw new Error("O código precisa ter de 3 a 30 letras ou números.");
  if (!SERVICOS_CUPOM.some((s) => s.valor === c.servico)) throw new Error("Escolha o serviço.");
  const quantia = Math.round(Number(c.quantia) * 100) / 100;
  if (!Number.isFinite(quantia) || quantia <= 0) throw new Error("Informe o desconto.");
  if (c.tipo === "percentual" && quantia > 100) throw new Error("O percentual vai até 100%.");
  if (c.tipo === "valor" && quantia > 99_999_999) throw new Error("Valor alto demais.");
  if (c.validoAte && !/^\d{4}-\d{2}-\d{2}$/.test(c.validoAte))
    throw new Error("Data de validade inválida.");
  return {
    codigo,
    valor: c.tipo === "valor" ? quantia : null,
    percentual: c.tipo === "percentual" ? quantia : null,
    servico: c.servico,
    origem_id: c.origemId || null,
    valido_ate: c.validoAte || null,
    ativo: c.ativo !== false,
  };
}

/**
 * Cupom digitado no orçamento manual: acha o cupom ativo e no prazo e calcula o desconto sobre
 * os itens do serviço do cupom. Devolve o motivo quando não vale.
 */
export function aplicarCupom(
  codigo: string,
  cupons: CupomDoOrcamento[],
  baseDoServico: Record<Servico, number>,
  hoje: string,
): { ok: true; cupom: CupomDoOrcamento; desconto: number } | { ok: false; motivo: string } {
  const limpo = limparCodigo(codigo);
  if (!limpo) return { ok: false, motivo: "Digite o código do cupom." };
  const cupom = cupons.find((c) => c.codigo === limpo);
  if (!cupom) return { ok: false, motivo: `Cupom ${limpo} não existe ou está inativo.` };
  if (!cupomNoPrazo(cupom.validoAte, hoje))
    return { ok: false, motivo: `O cupom ${limpo} venceu.` };
  const base = baseDoServico[cupom.servico] ?? 0;
  if (base <= 0) {
    const nome = SERVICOS_CUPOM.find((s) => s.valor === cupom.servico)!.rotulo.toLowerCase();
    return {
      ok: false,
      motivo: `O cupom ${limpo} vale só para ${nome}, e o orçamento não tem esse serviço.`,
    };
  }
  return { ok: true, cupom, desconto: valorDoCupom(cupom, base) };
}
