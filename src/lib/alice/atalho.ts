/**
 * Atalho do apressado (plano "Alice e vendas", item 1, 12/11): quando o cliente já disse o item e
 * o CEP (ou rua e bairro) e pede o preço de forma explícita, a Alice manda o vídeo e o orçamento na
 * mesma resposta, sem mais pergunta e sem o áudio de explicação. O motor recusa a resposta que não
 * trouxer o valor. Só liga com ia_configuracoes.atalho_apressado. Regras puras, sem banco.
 */
import type { MensagemHistorico } from "./prompt";
import { temPreco } from "./preco-depois";

const semAcento = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const COISA = "(?:valor(?:es)?|preco|orcamento|proposta)";
/** Pedido explícito de preço ("quanto fica?", "qual o valor?", "pode mandar", "me passa o orçamento"). */
const PEDE_PRECO = new RegExp(
  [
    `\\bquanto\\s+(?:que\\s+)?(?:e|eh|fica|ficaria|custa|custaria|sai|sairia|seria|ta|esta|cobra[mn]?|voces\\s+cobram|vai\\s+(?:ficar|custar|sair))\\b`,
    `\\bquanto\\s*\\?`,
    `\\bqual\\s+(?:e\\s+|seria\\s+)?(?:o\\s+)?${COISA}\\b`,
    `\\b(?:me\\s+)?(?:passa|passe|passar|manda|mande|mandar|envia|envie|enviar|fala|fale|diz|diga|informa|informe)\\s+(?:ai\\s+|logo\\s+|so\\s+)?(?:o\\s+|um\\s+|os\\s+)?${COISA}\\b`,
    `\\bpode\\s+(?:me\\s+)?(?:mandar|passar|enviar)\\b`,
    `\\b(?:so|somente|apenas)\\s+(?:o\\s+)?${COISA}\\b`,
    `\\b(?:quero|queria|gostaria\\s+de|preciso\\s+de|preciso)\\s+(?:saber\\s+)?(?:o\\s+|um\\s+|do\\s+)?${COISA}\\b`,
    `\\b(?:saber|sabe)\\s+(?:o\\s+|qual\\s+o\\s+)?${COISA}\\b`,
    `\\b${COISA}\\s*\\?`,
  ].join("|"),
);

/** O cliente disse o que quer limpar. */
const ITEM =
  /\b(?:sofas?|poltronas?|colchao|colchoes|cadeiras?|tapetes?|puffs?|pufes?|cabeceiras?|estofados?|carpetes?|persianas?|cortinas?|recamier|chaise|namoradeira|bicama|berco|carrinho|cadeirinha|bebe\s+conforto|bancos?\s+d[oe]\s+carro|estofamento)\b/;

const CEP = /(?:^|\D)\d{5}[-.\s]?\d{3}(?!\d)/;
/** Rua e bairro escritos pelo cliente (para quem não sabe o CEP). */
const ENDERECO = /\b(?:rua|avenida|av\.?|alameda|travessa|estrada|rodovia|praca)\s+[a-z0-9]/;

const textoDe = (m: MensagemHistorico) =>
  semAcento([m.texto, m.transcricao].filter(Boolean).join(" "));

export function pedeOPreco(texto: string | null | undefined): boolean {
  return PEDE_PRECO.test(semAcento(texto ?? ""));
}

export type Atalho = {
  ativo: boolean;
  /** O que falta para o atalho valer (medição e testes). */
  falta: Array<"pedido_de_preco" | "item" | "cep"> | null;
};

/**
 * O atalho vale quando: a última fala do cliente (tudo o que ele escreveu depois da última
 * mensagem da empresa) pede o preço; o item já apareceu na conversa (em palavras ou em foto); o CEP
 * ou a rua já apareceu; e nenhum valor foi enviado ainda (depois do orçamento, a conversa segue o
 * roteiro normal).
 */
export function atalhoDoApressado(
  mensagens: MensagemHistorico[],
  o: { enderecoConhecido?: boolean } = {},
): Atalho {
  if (mensagens.some((m) => m.direcao === "Enviada" && temPreco(m.texto)))
    return { ativo: false, falta: null };
  const doCliente = mensagens.filter((m) => m.direcao === "Recebida");
  if (!doCliente.length || mensagens[mensagens.length - 1]?.direcao !== "Recebida")
    return { ativo: false, falta: null };
  let ultimaDaEmpresa = -1;
  mensagens.forEach((m, i) => {
    if (m.direcao === "Enviada") ultimaDaEmpresa = i;
  });
  const ultimaFala = mensagens
    .slice(ultimaDaEmpresa + 1)
    .map(textoDe)
    .join(" ");
  const tudo = doCliente.map(textoDe).join(" ");
  const falta: NonNullable<Atalho["falta"]> = [];
  if (!PEDE_PRECO.test(ultimaFala)) falta.push("pedido_de_preco");
  if (!ITEM.test(tudo) && !doCliente.some((m) => m.imagens.length > 0)) falta.push("item");
  if (!o.enderecoConhecido && !CEP.test(tudo) && !ENDERECO.test(tudo)) falta.push("cep");
  return { ativo: falta.length === 0, falta };
}

/** A pergunta do motivo ("o que mais te incomoda…") já foi feita nesta conversa. */
export function jaPerguntouOMotivo(mensagens: MensagemHistorico[]): boolean {
  return mensagens.some((m) => m.direcao === "Enviada" && /mais te incomoda/.test(textoDe(m)));
}

/** Aviso do momento quando o atalho vale: manda mais que a regra nº 1 nesta resposta. */
export const AVISO_ATALHO = [
  "Atalho do apressado (vale mais que a regra nº 1 e que o roteiro nesta resposta): o cliente já disse o item e o CEP e pediu o preço. Não faça nenhuma pergunta antes do orçamento e não mande a explicação do serviço, nem em texto nem em áudio.",
  'Nesta resposta, nesta ordem: (1) se ainda não se apresentou, cumprimente e apresente-se numa frase; (2) enviar_mensagem: "Enquanto você assiste, já estou montando seu orçamento 💙"; (3) enviar_video do serviço certo; (4) criar_orcamento; (5) enviar_mensagem com o cartão do orçamento inteiro; (6) texto final: "Prontinho, [nome]! Te enviei a proposta ☺️ / Ela faz sentido pro que você está buscando?".',
  'Sem foto, use o tipo e o tamanho que o cliente disse e avise, depois do cartão, que "o valor final o técnico confirma no local". Item fora da tabela ou endereço fora da área: transfira.',
  "O sistema não aceita esta resposta sem o valor.",
].join(" ");

/** Recado para refazer a resposta que veio sem o valor (uma vez só). */
export const REFAZER_ATALHO =
  '[sistema] Resposta não enviada: o cliente já disse o item e o CEP e pediu o preço, e a sua resposta não trouxe o valor. Refaça agora, sem repetir o que já foi enviado: criar_orcamento, enviar_mensagem com o cartão inteiro e o texto final ("Prontinho, [nome]! Te enviei a proposta ☺️ / Ela faz sentido pro que você está buscando?"). Só se o preço realmente não sair sem um dado (ex.: o tamanho do sofá, para achar o item na tabela), faça essa única pergunta, numa frase, dizendo que com ela você já manda o valor.';

/** Aviso do momento: a pergunta do motivo é feita uma vez só. */
export const AVISO_MOTIVO_JA_FEITO =
  "Você já fez a pergunta do motivo nesta conversa (o que mais incomoda): não repita, nem com outras palavras. Se o cliente não respondeu, siga adiante.";

/** Resposta das ferramentas de áudio durante o atalho. */
export const RECUSA_AUDIO_NO_ATALHO =
  "Atalho do apressado: nesta resposta não vai áudio de explicação. Mande o vídeo e o orçamento.";
