/**
 * Regra nº 1 (26/10, todas as empresas): nunca preço antes de valor. O cartão de orçamento não pode
 * ser a primeira mensagem da Alice numa conversa nem sair antes de o cliente responder pelo menos
 * uma pergunta de diagnóstico. Funções puras: o motor decide a trava pelo histórico.
 */
import type { MensagemHistorico } from "./prompt";

/** Texto com valor em reais (cartão de orçamento, preço solto). */
export function temPreco(texto: string | null | undefined): boolean {
  return /R\$\s?\d/.test(texto ?? "");
}

/**
 * Preço liberado: a empresa (Alice ou equipe) já fez uma pergunta e o cliente respondeu depois.
 * `truncado` = o histórico veio cortado (conversa longa): o diagnóstico já ficou para trás.
 */
export function precoLiberado(mensagens: MensagemHistorico[], truncado = false): boolean {
  if (truncado) return true;
  let perguntou = false;
  for (const m of mensagens) {
    if (m.direcao === "Enviada") {
      const texto = [m.texto, m.transcricao].filter(Boolean).join(" ");
      if (texto.includes("?")) perguntou = true;
    } else if (perguntou) {
      return true;
    }
  }
  return false;
}

/** Aviso do momento para a resposta em que o preço ainda está travado. */
export const AVISO_PRECO_TRAVADO =
  "Trava de preço (regra nº 1): nesta resposta NÃO mande preço, total nem orçamento (criar_orcamento e mensagens com valor ficam bloqueados pelo sistema). Cumprimente, apresente-se (se ainda não se apresentou), responda as dúvidas conversando e faça uma ou duas perguntas de diagnóstico. O orçamento sai depois que o cliente responder.";

/** Resposta da ferramenta quando o preço ainda está travado. */
export const RECUSA_PRECO_TRAVADO =
  "Bloqueado pela regra nº 1: ainda não pode mandar preço nem orçamento nesta conversa. Primeiro cumprimente, apresente-se e faça uma ou duas perguntas de diagnóstico (bairro pelo CEP, foto, motivo). O orçamento fica liberado depois que o cliente responder. Não comente esse bloqueio com o cliente.";
