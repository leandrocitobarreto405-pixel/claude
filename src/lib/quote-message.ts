/** Monta a mensagem de WhatsApp do orçamento. Nunca inclui custos, km ou margem. */
import { brl } from "@/lib/format";
import { TIPO_LABEL, type Quote, type QuoteItem } from "@/lib/quotes";

function listaEstofados(items: QuoteItem[]) {
  return items
    .map(
      (it) =>
        `• ${it.quantidade}x ${it.nome_snapshot} — ${TIPO_LABEL[it.tipo_servico]}: ${brl(it.subtotal)}`,
    )
    .join("\n");
}

const HIGIENIZACAO = `*Higienização Premium TurbineClean*

Higienização profunda com extração a quente, produtos biodegradáveis e sem cheiro forte. Removemos poeira, ácaros, manchas, suor e odores, devolvendo o toque e o frescor do seu estofado.

✅ Equipamento profissional de extração
✅ Produtos seguros para crianças e animais
✅ Secagem rápida, sem molhar o ambiente
✅ Equipe uniformizada e horário combinado`;

const IMPERMEABILIZACAO = `*Impermeabilização Premium Turbine Clean*

Aplicamos uma proteção invisível que envolve cada fibra do tecido. Líquidos escorrem sem penetrar, sujeira não gruda e a limpeza do dia a dia passa a ser feita com um pano.

✅ Proteção contra líquidos, manchas e sujeira
✅ Não altera a cor nem o toque do tecido
✅ Produto atóxico, seguro para crianças e animais
🛡️ *Garantia de 3 anos* na proteção aplicada`;

const COMBINADO = `*Higienização e Impermeabilização Premium Turbine Clean*

Primeiro fazemos a higienização profunda com extração a quente, removendo poeira, ácaros, manchas e odores. Depois aplicamos a impermeabilização, que protege cada fibra: líquidos escorrem sem penetrar e a sujeira não gruda.

✅ Higienização profunda com equipamento profissional
✅ Proteção contra líquidos, manchas e sujeira
✅ Produtos atóxicos, seguros para crianças e animais
✅ Secagem rápida, sem molhar o ambiente
🛡️ *Garantia de 3 anos* na impermeabilização`;

export function quoteWhatsappMessage(quote: Quote, items: QuoteItem[]): string {
  const tipos = new Set(items.map((it) => it.tipo_servico));
  const base =
    tipos.size > 1 ? COMBINADO : tipos.has("impermeabilizacao") ? IMPERMEABILIZACAO : HIGIENIZACAO;

  const total = Number(quote.total ?? 0);
  const aVista =
    quote.valor_a_vista && quote.valor_a_vista > 0 ? Number(quote.valor_a_vista) : total;
  const parcela = total / 5;

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
    `*Total: 5x de ${brl(parcela)} sem juros ou à vista por ${brl(aVista)}*`,
    "",
    "_Orçamento válido por 7 dias._",
  );

  return partes.join("\n");
}

export function whatsappLink(phone: string | null, message: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const numero = digits.length >= 10 ? (digits.startsWith("55") ? digits : `55${digits}`) : "";
  return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`;
}
