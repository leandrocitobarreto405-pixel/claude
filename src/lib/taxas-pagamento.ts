/**
 * Grade das taxas de pagamento (29/10): a tela mostra todas as linhas mesmo sem taxa cadastrada
 * (a empresa só preenche) e a tabela pronta da maquininha entra por um botão (banco:
 * aplicar_tabela_taxas). Sem banco, para poder testar.
 */

export type LinhaGrade = { channel: string; payment_type: string; installments: number };

const parcelas = (channel: string, n: number): LinhaGrade[] =>
  Array.from({ length: n }, (_, i) => ({ channel, payment_type: "Crédito", installments: i + 1 }));

/** Maquininha (débito, crédito 1x–12x, Pix), link (crédito 1x–12x, Pix), Pix direto, dinheiro… */
export const GRADE_TAXAS: { grupo: string; linhas: LinhaGrade[] }[] = [
  {
    grupo: "Maquininha",
    linhas: [
      { channel: "Maquininha", payment_type: "Débito", installments: 1 },
      ...parcelas("Maquininha", 12),
      { channel: "Maquininha", payment_type: "Pix", installments: 1 },
    ],
  },
  {
    grupo: "Link de pagamento",
    linhas: [
      ...parcelas("Link de pagamento", 12),
      { channel: "Link de pagamento", payment_type: "Pix", installments: 1 },
    ],
  },
  {
    grupo: "Outras formas",
    linhas: [
      { channel: "Pix direto", payment_type: "Pix", installments: 1 },
      { channel: "Dinheiro", payment_type: "Dinheiro", installments: 1 },
      { channel: "Transferência", payment_type: "Transferência", installments: 1 },
      { channel: "Outro", payment_type: "Outro", installments: 1 },
    ],
  },
];

export const MAQUININHAS = [
  { id: "infinitepay", rotulo: "InfinitePay", tabelaPronta: true },
  { id: "santander", rotulo: "Santander", tabelaPronta: false },
  { id: "personalizada", rotulo: "Personalizada", tabelaPronta: false },
] as const;
export type Maquininha = (typeof MAQUININHAS)[number]["id"];

export function ehMaquininha(v: unknown): v is Maquininha {
  return MAQUININHAS.some((m) => m.id === v);
}

export const chaveDaLinha = (l: LinhaGrade) => `${l.channel}|${l.payment_type}|${l.installments}`;

/** "Crédito 3x", "Débito", "Pix". */
export function rotuloDaLinha(l: LinhaGrade): string {
  return l.payment_type === "Crédito" ? `Crédito ${l.installments}x` : l.payment_type;
}

/** Linhas cadastradas que não estão na grade (ex.: boleto): aparecem à parte, para não sumir. */
export function foraDaGrade<T extends LinhaGrade>(cadastradas: T[]): T[] {
  const naGrade = new Set(GRADE_TAXAS.flatMap((g) => g.linhas.map(chaveDaLinha)));
  return cadastradas.filter((r) => !naGrade.has(chaveDaLinha(r)));
}
