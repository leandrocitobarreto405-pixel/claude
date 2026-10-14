// Regras do pagamento ao concluir um serviço (sem acesso a banco, para poder testar).

/** Pago · Pago em parte · Ainda não pagou. Nada vem marcado: a pessoa escolhe. */
export type EscolhaPagamento = "pago" | "parte" | "nao";

export const ESCOLHAS: { id: EscolhaPagamento; rotulo: string; descricao: string }[] = [
  { id: "pago", rotulo: "Pago", descricao: "Recebeu o valor inteiro." },
  {
    id: "parte",
    rotulo: "Pago em parte",
    descricao: "Recebeu uma parte; o resto fica em A receber.",
  },
  { id: "nao", rotulo: "Ainda não pagou", descricao: "Nada é registrado; a OS fica em A receber." },
];

function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * O que impede de concluir, ou null quando está tudo certo.
 * `valor`: o que este serviço cobra; `limite`: o máximo que pode ser recebido aqui (na visita
 * que cobra a OS inteira, o total da OS).
 */
export function erroDoPagamento(args: {
  escolha: EscolhaPagamento | null;
  soma: number;
  valor: number;
  limite: number;
}): string | null {
  const { escolha, soma, valor, limite } = args;
  if (escolha === null)
    return "Escolha se o cliente pagou: Pago, Pago em parte ou Ainda não pagou.";
  if (escolha === "nao") return null;
  if (!(soma > 0)) return "Informe o valor recebido.";
  if (soma - limite > 0.01)
    return `A soma dos pagamentos (${brl(soma)}) ultrapassa o que pode ser recebido neste serviço (${brl(limite)}).`;
  if (escolha === "pago" && valor - soma > 0.01)
    return `Em "Pago" a soma tem de ser o valor do serviço (${brl(valor)}). Recebeu menos? Escolha "Pago em parte".`;
  if (escolha === "parte" && soma - valor > -0.01)
    return `Em "Pago em parte" o valor recebido tem de ser menor que ${brl(valor)}. Recebeu tudo? Escolha "Pago".`;
  return null;
}

/**
 * Toda linha de pagamento gravada é dinheiro que entrou: nasce "Pago". "Parcialmente pago" é
 * situação da OS (saldo em aberto), nunca de uma linha, senão a linha some do DRE e do A receber.
 */
export const STATUS_DA_LINHA = "Pago";

/** Valor que o campo "Valor recebido" ganha ao escolher: só em "Pago" vem preenchido. */
export function valorInicialDaParte(escolha: EscolhaPagamento, valor: number): string {
  return escolha === "pago" ? valor.toFixed(2).replace(".", ",") : "";
}
