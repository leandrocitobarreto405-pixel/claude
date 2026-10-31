/** CEP obrigatório antes do preço (31/10): sem CEP nem rua e bairro, a Alice não cria orçamento. */

/** CEP com 8 dígitos, ou endereço com pelo menos uma palavra de verdade (rua, bairro). */
export function temEnderecoParaOrcamento(cep: string | null, endereco: string | null): boolean {
  if ((cep ?? "").replace(/\D/g, "").length === 8) return true;
  return /\p{L}{3,}/u.test(endereco ?? "");
}

export const SEM_ENDERECO =
  "Sem CEP nem endereço o orçamento não sai. Não passe valores: comente a foto (uma frase de empatia) e peça só o CEP (ou rua e bairro). Com a resposta, crie o orçamento com `cep` (ou `endereco`).";
