/**
 * Quem vendeu (regra aprovada em 29/10, só cálculo na tela; as OS antigas não mudam): vendeu quem
 * fez o orçamento que virou a OS. Se a equipe negociou entre o orçamento e a OS (transferência por
 * desconto, combo, pagamento ou item fora da tabela, ou mensagem da equipe com preço ou condição),
 * vendeu quem está na OS. OS sem orçamento ligado: quem está na OS.
 */

/** Motivos de transferência que contam como negociação da equipe. */
export const MOTIVO_NEGOCIACAO = /desconto|combo|pagamento|fora da tabela/i;
/** Mensagem da equipe com preço ou condição. */
export const TEXTO_COM_PRECO = /(R\$|desconto|condi[cç][aã]o|pix|parcel)/i;

export type FatosDaOs = {
  /** Vendedora gravada na OS. */
  vendedoraOs: string | null;
  /** Autor do orçamento que virou a OS (null = OS sem orçamento ligado). */
  orcamento: { vendedora: string | null } | null;
  /** Motivos das transferências da Alice para a equipe entre o orçamento e a OS. */
  transferencias: string[];
  /** Textos das mensagens da equipe ao cliente entre o orçamento e a OS. */
  mensagensEquipe: string[];
};

export type RegraQuemVendeu = "orcamento" | "negociou" | "sem_orcamento";

export function equipeNegociou(f: Pick<FatosDaOs, "transferencias" | "mensagensEquipe">): boolean {
  return (
    f.transferencias.some((m) => MOTIVO_NEGOCIACAO.test(m)) ||
    f.mensagensEquipe.some((t) => TEXTO_COM_PRECO.test(t))
  );
}

export function vendedoraPelaRegra(f: FatosDaOs): {
  vendedora: string | null;
  regra: RegraQuemVendeu;
} {
  if (!f.orcamento) return { vendedora: f.vendedoraOs, regra: "sem_orcamento" };
  if (equipeNegociou(f)) return { vendedora: f.vendedoraOs, regra: "negociou" };
  return { vendedora: f.orcamento.vendedora ?? f.vendedoraOs, regra: "orcamento" };
}
