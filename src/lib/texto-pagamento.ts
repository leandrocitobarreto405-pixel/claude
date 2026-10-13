/**
 * Linhas de pagamento da mensagem de orçamento (formato sem vitrine), iguais no botão do app e
 * na Alice:
 *   *Total:* R$ 339,00 em até 5x de R$ 67,80 sem juros no cartão
 *   *No Pix (5% de desconto): R$ 322,05*
 * Sem desconto no Pix, só a linha do cartão. Só texto: os valores chegam já calculados.
 */
import { brl } from "@/lib/format";

const pctTexto = (p: number) => p.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export function linhasPagamento(v: {
  total: number;
  parcelas: number;
  /** Valor no Pix (já calculado). */
  pix: number | null;
  /** Desconto do Pix da empresa, em %. */
  pixPct: number;
}): string {
  const total = Number(v.total);
  const n = Math.max(1, Math.round(v.parcelas));
  const cartao =
    n > 1
      ? `*Total:* ${brl(total)} em até ${n}x de ${brl(total / n)} sem juros no cartão`
      : `*Total:* ${brl(total)} no cartão`;
  const pix = v.pix === null ? null : Number(v.pix);
  if (!(v.pixPct > 0) || pix === null || !(pix > 0) || pix >= total - 0.004) return cartao;
  // Valor do Pix editado à mão no orçamento: o percentual mostrado é o que o valor dá.
  const esperado = Math.round(total * (1 - v.pixPct / 100) * 100) / 100;
  const pct =
    Math.abs(esperado - pix) <= 0.05 ? v.pixPct : Math.round((1 - pix / total) * 1000) / 10;
  return `${cartao}\n*No Pix (${pctTexto(pct)}% de desconto): ${brl(pix)}*`;
}
