/**
 * "Voltar na conversa" (05/11): prioridade da tarefa. Sem limite por noite; P1 quando a conversa é
 * negociação, preço ou concorrência (o cliente achou caro, pediu desconto, comparou com outra
 * empresa); senão P2 (hoje).
 */
const NEGOCIACAO =
  /\bcaro\b|desconto|mais barat|outra empresa|outro or[cç]amento|outros or[cç]amentos|concorr|cobrir|melhorar o (valor|pre[cç]o)|baixar o (valor|pre[cç]o)|fazer por|faz por|consegue (fazer|chegar|por)|parcel|negoci|pix (fica|sai|com)|(valor|pre[cç]o) (alto|salgado|puxado)|fora do (meu )?or[cç]amento|ficou (alto|acima)|achei (alto|salgado|puxado)/i;

/** A conversa (textos do cliente e da equipe, do mais novo para o mais antigo) é negociação? */
export function conversaDeNegociacao(textos: Array<string | null | undefined>): boolean {
  return textos.slice(0, 15).some((t) => Boolean(t && NEGOCIACAO.test(t)));
}

/** P1 em negociação/preço/concorrência; P2 nos outros casos. */
export function prioridadeVoltarConversa(textos: Array<string | null | undefined>): 1 | 2 {
  return conversaDeNegociacao(textos) ? 1 : 2;
}
