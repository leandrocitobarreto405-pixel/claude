// Regras do Financeiro › Resumo (sem acesso a banco, para poder testar).
import { addDaysISO, monthEnd, monthStart, shiftMonth } from "@/lib/format";

export const NOMES_MES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Os `n` meses até `mes` (inclusive), do mais antigo para o mais recente. */
export function mesesAte(
  mes: string,
  n = 6,
): { mes: string; rotulo: string; de: string; ate: string }[] {
  const lista = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = shiftMonth(mes, -i);
    lista.push({
      mes: m,
      rotulo: NOMES_MES[Number(m.slice(5, 7)) - 1]!,
      de: monthStart(m),
      ate: monthEnd(m),
    });
  }
  return lista;
}

export type Entrada = { data: string | null; valor: number };

/** Soma por mês (pela data) do que entrou e do que saiu. */
export function porMes(
  meses: { mes: string; rotulo: string; de: string; ate: string }[],
  recebidos: Entrada[],
  pagos: Entrada[],
): { mes: string; rotulo: string; recebido: number; pago: number }[] {
  const soma = (lista: Entrada[], de: string, ate: string) =>
    round2(
      lista.filter((e) => e.data && e.data >= de && e.data <= ate).reduce((s, e) => s + e.valor, 0),
    );
  return meses.map((m) => ({
    mes: m.mes,
    rotulo: m.rotulo,
    recebido: soma(recebidos, m.de, m.ate),
    pago: soma(pagos, m.de, m.ate),
  }));
}

/** Despesas pagas por categoria, da maior para a menor. */
export function porCategoria(
  despesas: { categoria: string; valor: number }[],
): { categoria: string; valor: number }[] {
  const mapa = new Map<string, number>();
  for (const d of despesas) {
    if (!(d.valor > 0)) continue;
    const c = d.categoria.trim() || "Outros";
    mapa.set(c, round2((mapa.get(c) ?? 0) + d.valor));
  }
  return [...mapa.entries()]
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor || a.categoria.localeCompare(b.categoria));
}

/**
 * Próximos 30 dias: a receber (concluídos sem recebimento + agendados até o 30º dia) e a pagar
 * (despesas em aberto com vencimento até o 30º dia; as já vencidas contam).
 */
export function proximos30(
  hoje: string,
  aReceber: { kind: "agendado" | "concluido"; scheduledDate: string; balance: number }[],
  despesas: { due_date: string | null; restante: number; status: string }[],
): { aReceber: number; aPagar: number; aReceberConcluidos: number; aPagarVencidas: number } {
  const limite = addDaysISO(hoje, 30);
  const concl = round2(
    aReceber.filter((i) => i.kind === "concluido").reduce((s, i) => s + i.balance, 0),
  );
  const agend = round2(
    aReceber
      .filter((i) => i.kind === "agendado" && i.scheduledDate <= limite)
      .reduce((s, i) => s + i.balance, 0),
  );
  const abertas = despesas.filter(
    (d) => !["Pago", "Cancelado"].includes(d.status) && d.restante > 0,
  );
  const aPagar = round2(
    abertas.filter((d) => !d.due_date || d.due_date <= limite).reduce((s, d) => s + d.restante, 0),
  );
  const vencidas = round2(
    abertas.filter((d) => d.due_date && d.due_date < hoje).reduce((s, d) => s + d.restante, 0),
  );
  return {
    aReceber: round2(concl + agend),
    aPagar,
    aReceberConcluidos: concl,
    aPagarVencidas: vencidas,
  };
}

export type ResumoFinanceiro = {
  mes: string;
  entrou: number;
  saiu: number;
  saldo: number;
  quantidadeRecebimentos: number;
  porMes: { mes: string; rotulo: string; recebido: number; pago: number }[];
  porCategoria: { categoria: string; valor: number }[];
  proximos: {
    aReceber: number;
    aPagar: number;
    aReceberConcluidos: number;
    aPagarVencidas: number;
  };
};

/** Mês anterior / próximo em formato "aaaa-mm". */
export function mesVizinho(mes: string, passo: -1 | 1): string {
  const [a = 2026, m = 1] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + passo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
