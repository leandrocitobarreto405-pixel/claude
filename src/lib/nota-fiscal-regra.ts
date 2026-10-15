// Regra "Gerar pedido de nota" por empresa (sem acesso a banco, para poder testar).
// Guardada em app_settings com a chave CHAVE_REGRA_NOTA; sem valor, vale "cpf_cnpj".

export type RegraNota = "sempre" | "cpf_cnpj" | "nunca";

export const CHAVE_REGRA_NOTA = "invoice_rule";
export const REGRA_NOTA_PADRAO: RegraNota = "cpf_cnpj";

export const REGRAS_NOTA: { id: RegraNota; rotulo: string; descricao: string }[] = [
  {
    id: "sempre",
    rotulo: "Sempre",
    descricao: 'Toda conclusão já vem com "Precisa de nota fiscal?" marcado.',
  },
  {
    id: "cpf_cnpj",
    rotulo: "Se o cliente tem CPF ou CNPJ",
    descricao: "Vem marcado só quando o cadastro do cliente tem CPF ou CNPJ (padrão).",
  },
  {
    id: "nunca",
    rotulo: "Nunca",
    descricao: "Nunca vem marcado; a pessoa marca à mão se precisar.",
  },
];

export function regraNota(valor: unknown): RegraNota {
  return valor === "sempre" || valor === "cpf_cnpj" || valor === "nunca"
    ? valor
    : REGRA_NOTA_PADRAO;
}

/** CPF (11 dígitos) ou CNPJ (14) preenchido, com ou sem pontuação. */
export function temCpfOuCnpj(documento: string | null | undefined): boolean {
  const digitos = (documento ?? "").replace(/\D/g, "");
  return digitos.length === 11 || digitos.length === 14;
}

/** "Precisa de nota fiscal?" já vem marcado conforme a regra da empresa. */
export function precisaNotaPorRegra(
  regra: RegraNota,
  documento: string | null | undefined,
): boolean {
  if (regra === "sempre") return true;
  if (regra === "nunca") return false;
  return temCpfOuCnpj(documento);
}

/**
 * Valor do pedido de nota: o total da OS (não o da visita). Uma OS com mais de uma visita gera
 * um pedido só, pelo total. Sem total na OS (OS antiga), vale o valor do serviço.
 */
export function valorDaNota(totalOs: number | null | undefined, valorDoServico: number): number {
  const total = Number(totalOs ?? 0);
  return total > 0 ? total : valorDoServico;
}
