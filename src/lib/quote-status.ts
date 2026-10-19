export type QuoteStatus = "rascunho" | "enviado" | "aprovado" | "recusado" | "convertido";

/**
 * Orçamento salvo = enviado: a equipe salva e manda pelo WhatsApp (mensagem ou proposta), então
 * "rascunho" vira "enviado". Aprovado, recusado e "virou OS" ficam como estão.
 */
export function statusAoSalvar(status: QuoteStatus | null | undefined): QuoteStatus {
  return !status || status === "rascunho" ? "enviado" : status;
}

/** Situações que a equipe escolhe na mão ("virou OS" só pelo botão de criar a OS). */
export function situacoesEscolhiveis(atual: QuoteStatus): QuoteStatus[] {
  const lista: QuoteStatus[] = ["enviado", "aprovado", "recusado"];
  return lista.includes(atual) ? lista : [atual, ...lista];
}
