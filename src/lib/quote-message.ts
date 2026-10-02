/** Monta a mensagem de WhatsApp do orçamento. Nunca inclui custos, km ou margem. */
import { brl } from "@/lib/format";
import { preencherTexto } from "@/lib/modelos-mensagem";
import { TIPO_LABEL, type Quote, type QuoteItem } from "@/lib/quotes";

function listaEstofados(items: QuoteItem[]) {
  return items
    .map(
      (it) =>
        `• ${it.quantidade}x ${it.nome_snapshot} — ${TIPO_LABEL[it.tipo_servico]}: ${brl(it.subtotal)}`,
    )
    .join("\n");
}

/**
 * Textos e números da empresa (tela Modelos de mensagem e configuração da Alice). Sem eles, os
 * textos padrão do app.
 */
export type TextosOrcamento = {
  empresa: string;
  parcelasMax: number;
  validadeDias: number;
  texto: (chave: string) => string;
};

export function quoteWhatsappMessage(quote: Quote, items: QuoteItem[], t: TextosOrcamento): string {
  const tipos = new Set(items.map((it) => it.tipo_servico));
  const chave =
    tipos.size > 1
      ? "orcamento_combinado"
      : tipos.has("impermeabilizacao")
        ? "orcamento_impermeabilizacao"
        : "orcamento_higienizacao";
  const base = preencherTexto(t.texto(chave), { empresa: t.empresa });

  const total = Number(quote.total ?? 0);
  const aVista =
    quote.valor_a_vista && quote.valor_a_vista > 0 ? Number(quote.valor_a_vista) : total;
  const parcelas = Math.max(1, t.parcelasMax);
  const parcela = total / parcelas;

  const partes = [
    `Olá, ${quote.cliente_nome}! Tudo bem?`,
    "",
    base,
    "",
    "*Estofados:*",
    listaEstofados(items),
  ];

  if (Number(quote.desconto ?? 0) > 0) {
    partes.push("", `Subtotal: ${brl(quote.subtotal)}`, `Desconto: -${brl(quote.desconto)}`);
  }

  partes.push(
    "",
    preencherTexto(t.texto("orcamento_fechamento"), {
      parcelas: String(parcelas),
      parcela: brl(parcela),
      a_vista: brl(aVista),
      validade: String(t.validadeDias),
    }),
  );

  return partes.join("\n");
}

export function whatsappLink(phone: string | null, message: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const numero = digits.length >= 10 ? (digits.startsWith("55") ? digits : `55${digits}`) : "";
  return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`;
}
