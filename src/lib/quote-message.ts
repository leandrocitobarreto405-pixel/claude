/** Monta a mensagem de WhatsApp do orçamento. Nunca inclui custos, km ou margem. */
import { brl } from "@/lib/format";
import { preencherTexto } from "@/lib/modelos-mensagem";
import type { RegrasOrcamento } from "@/lib/orcamento-regras";
import { TIPO_LABEL, type Quote, type QuoteItem } from "@/lib/quotes";

type ItemMensagem = Pick<
  QuoteItem,
  "quantidade" | "nome_snapshot" | "tipo_servico" | "subtotal" | "desconto_regra_texto"
> &
  Partial<Pick<QuoteItem, "adicional_pos_fechamento">>;

function listaEstofados(items: ItemMensagem[], comPreco: boolean) {
  return items
    .map((it) => {
      const regra = it.adicional_pos_fechamento
        ? " (adicional)"
        : it.desconto_regra_texto
          ? ` (${it.desconto_regra_texto})`
          : "";
      return comPreco
        ? `• ${it.quantidade}x ${it.nome_snapshot} — ${TIPO_LABEL[it.tipo_servico]}${regra}: ${brl(it.subtotal)}`
        : `• ${it.quantidade}x ${it.nome_snapshot}${regra}`;
    })
    .join("\n");
}

/**
 * Textos e números da empresa (tela Modelos de mensagem, configuração da Alice e regras do
 * orçamento). Sem eles, os textos padrão do app.
 */
export type TextosOrcamento = {
  empresa: string;
  parcelasMax: number;
  validadeDias: number;
  texto: (chave: string) => string;
  /** Regras de orçamento da empresa (percentuais de boas-vindas e adicionais). */
  regras?: RegrasOrcamento;
};

type QuoteMensagem = Pick<
  Quote,
  "cliente_nome" | "subtotal" | "desconto" | "total" | "valor_a_vista"
> &
  Partial<
    Pick<
      Quote,
      | "cliente_novo"
      | "acrescimo_sujidade"
      | "acrescimo_distancia"
      | "minimo_aplicado"
      | "valor_vitrine"
      | "valor_cartao"
      | "valor_pix"
      | "desconto_tipo"
      | "desconto_pct"
    >
  >;

export function quoteWhatsappMessage(
  quote: QuoteMensagem,
  items: ItemMensagem[],
  t: TextosOrcamento,
): string {
  const tipos = new Set(items.map((it) => it.tipo_servico));
  const chave =
    tipos.size > 1
      ? "orcamento_combinado"
      : tipos.has("impermeabilizacao")
        ? "orcamento_impermeabilizacao"
        : "orcamento_higienizacao";
  const base = preencherTexto(t.texto(chave), { empresa: t.empresa });
  const parcelas = Math.max(1, t.parcelasMax);
  const vitrine =
    quote.valor_vitrine !== null && quote.valor_vitrine !== undefined && quote.valor_cartao
      ? {
          vitrine: Number(quote.valor_vitrine),
          cartao: Number(quote.valor_cartao),
          pix: Number(quote.valor_pix ?? quote.valor_cartao),
        }
      : null;

  const partes = [
    `Olá, ${quote.cliente_nome}! Tudo bem?`,
    "",
    base,
    "",
    "*Estofados:*",
    listaEstofados(items, !vitrine),
  ];

  // Adicionais: com vitrine, só em texto (já estão nos valores); sem vitrine, com o valor.
  const adicionais: string[] = [];
  const sujidade = Number(quote.acrescimo_sujidade ?? 0);
  const distancia = Number(quote.acrescimo_distancia ?? 0);
  const minimo = Number(quote.minimo_aplicado ?? 0);
  if (sujidade > 0) {
    const pct = t.regras?.sujidade.pct;
    adicionais.push(
      vitrine
        ? `➕ Sujeira intensa${pct ? `: +${pct}%` : ""}`
        : `Acréscimo por sujeira intensa: ${brl(sujidade)}`,
    );
  }
  if (distancia > 0) {
    const pct = t.regras?.distancia.pct;
    adicionais.push(
      vitrine ? `➕ Deslocamento${pct ? `: +${pct}%` : ""}` : `Deslocamento: ${brl(distancia)}`,
    );
  }
  if (minimo > 0 && !vitrine) adicionais.push(`Ajuste para o valor mínimo: ${brl(minimo)}`);
  if (adicionais.length) partes.push("", ...adicionais);

  if (vitrine) {
    const novo = quote.cliente_novo !== false;
    partes.push(
      "",
      preencherTexto(t.texto(novo ? "orcamento_vitrine" : "orcamento_vitrine_cliente"), {
        vitrine: brl(vitrine.vitrine),
        boas_vindas: String(t.regras?.vitrine.boasVindasPct ?? 20),
        cartao: brl(vitrine.cartao),
        parcelas: String(parcelas),
        parcela: brl(vitrine.cartao / parcelas),
        pix: brl(vitrine.pix),
      }),
      "",
      preencherTexto(t.texto("orcamento_validade"), { validade: String(t.validadeDias) }),
    );
    return partes.join("\n");
  }

  const total = Number(quote.total ?? 0);
  const aVista =
    quote.valor_a_vista && quote.valor_a_vista > 0 ? Number(quote.valor_a_vista) : total;
  if (Number(quote.desconto ?? 0) > 0) {
    const pctTxt = quote.desconto_pct
      ? ` (${Number(quote.desconto_pct).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)`
      : "";
    const rotulo =
      quote.desconto_tipo === "campanha"
        ? `Desconto da campanha${pctTxt}`
        : quote.desconto_tipo === "indicacao"
          ? `Desconto de indicação${pctTxt}`
          : "Desconto";
    partes.push("", `Subtotal: ${brl(quote.subtotal)}`, `${rotulo}: -${brl(quote.desconto)}`);
  }
  partes.push(
    "",
    preencherTexto(t.texto("orcamento_fechamento"), {
      parcelas: String(parcelas),
      parcela: brl(total / parcelas),
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
