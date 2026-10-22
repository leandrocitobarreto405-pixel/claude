// Descadastro de marketing: reconhece quando o cliente pede para não receber mais promoções.
// Espelho da função private.mkt_pedido_saida (migração 20261130120000): o gatilho do banco marca o
// contato; aqui a Alice decide se a mensagem era SÓ o pedido (confirma com o texto fixo, sem IA)
// ou trazia outro assunto junto (confirma e segue a conversa). Sem banco nem rede, para testar.

export const CONFIRMACAO_DESCADASTRO = "Pronto, você não vai mais receber nossas promoções 💙";

/** Igual a private.texto_busca: minúsculas, sem acento, só letras/números, com espaço nas pontas. */
export function textoBusca(texto: string | null | undefined): string {
  const limpo = (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return ` ${limpo} `;
}

/** Pedidos claros: valem em qualquer conversa. */
const FORTES = [
  / (pare|para|parem|parar) de (me )?(mandar|enviar)/,
  / sair da (sua |sua s |vossa )?lista /,
  / (me )?(tira|tire|tirem|remove|remova|removam) (da|dessa|desta) lista /,
  / (me )?(tira|tire|tirem|remove|remova|removam) meu (numero|contato) /,
  / nao (me )?(mande|mandem|manda|envie|enviem) mais /,
  / descadastr/,
  / nao quero (mais )?receber (mais )?(ofertas?|promoc\w*|mensage\w*|propaganda\w*|msg|nada) /,
  / nao quero mais (ofertas?|promoc\w*|propaganda\w*|mensage\w*|msg) /,
  /^ (parar|pare|sair|stop|descadastrar) $/,
];

/** "Não quero mais" sozinho: só é pedido de saída se a mensagem for só isso ou se a pessoa recebeu
 *  campanha nos últimos 7 dias ("não quero mais o orçamento de terça" não marca ninguém). */
const SO_NAO_QUERO = /^ nao quero mais( obrigad[oa])?( obrigad[oa])? $/;
const NAO_QUERO = / nao quero mais /;

export function pedidoDeSaida(texto: string | null | undefined, campanhaRecente: boolean): boolean {
  const t = textoBusca(texto);
  if (FORTES.some((r) => r.test(t))) return true;
  if (SO_NAO_QUERO.test(t)) return true;
  return campanhaRecente && NAO_QUERO.test(t);
}

/** Palavras que não mudam o sentido de um pedido de saída (cortesia e o próprio pedido). */
const SEM_ASSUNTO = new Set(
  (
    "oi ola ok okay bom boa dia tarde noite por favor obrigado obrigada obg grato grata valeu " +
    "tchau abraco abracos beijo beijos ja e eu a o as os de da do das dos me mim meu minha voces " +
    "vcs vc voce nao mais quero receber mandar mande mandem manda enviar envie enviem pare para " +
    "parem parar sair lista sua dessa desta tira tire tirem remove remova removam numero contato " +
    "descadastrar descadastra descadastre descadastro stop ofertas oferta promocoes promocao " +
    "promocao propaganda propagandas mensagem mensagens msg nada isso pf pfv favor desculpa " +
    "desculpe sim entao certo"
  ).split(" "),
);

/** A mensagem é só o pedido de saída (sem outro assunto)? Então a Alice manda só a confirmação. */
export function soPedidoDeSaida(texto: string | null | undefined): boolean {
  const palavras = textoBusca(texto).trim().split(" ").filter(Boolean);
  if (!palavras.length) return false;
  return palavras.filter((p) => !SEM_ASSUNTO.has(p)).length === 0;
}

export type OrigemDescadastro = "cliente" | "marketing" | "equipe";

export const ROTULO_ORIGEM_DESCADASTRO: Record<OrigemDescadastro, string> = {
  cliente: "o cliente pediu na conversa",
  marketing: "pelo marketing (botão da campanha ou bloqueio no WhatsApp)",
  equipe: "a equipe desligou",
};

/** Prazo para a Alice confirmar: depois disso a confirmação perde o sentido e não sai mais. */
export const PRAZO_CONFIRMAR_MS = 2 * 3600_000;

export type ContatoMarketing = {
  marketing_optout_em?: string | null;
  marketing_optout_origem?: string | null;
  marketing_optout_confirmado_em?: string | null;
};

/** A Alice ainda deve confirmar o descadastro? Só quando o próprio cliente pediu na conversa, uma
 *  vez, há pouco, e com a resposta ligada na empresa. */
export function confirmacaoPendente(
  c: ContatoMarketing | null | undefined,
  respostaLigada: boolean,
  agora: Date,
): boolean {
  if (!respostaLigada || !c?.marketing_optout_em) return false;
  if (c.marketing_optout_origem !== "cliente" || c.marketing_optout_confirmado_em) return false;
  return agora.getTime() - new Date(c.marketing_optout_em).getTime() <= PRAZO_CONFIRMAR_MS;
}

/** Para a Alice, quando a mensagem trouxe outro assunto junto com o pedido de saída. */
export const INSTRUCAO_DESCADASTRO = `O cliente acabou de pedir para não receber promoções e já foi tirado do marketing (atendimento, confirmação de horário e pós-venda continuam normais). Comece a resposta exatamente com: "${CONFIRMACAO_DESCADASTRO}" e depois responda ao resto da mensagem dele. Não ofereça promoção nem desconto.`;
