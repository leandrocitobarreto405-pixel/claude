/**
 * Comissões a pagar (todas as empresas). Competência = mês em que o valor do serviço foi RECEBIDO
 * (pagamento Pago/Parcialmente pago, pela data do pagamento); base = valor cheio pago pelo
 * cliente, inclusive a parte do parceiro; percentual = o gravado na OS. Pagamento no 5º dia útil
 * do mês seguinte (segunda a sexta, sem feriados por enquanto).
 * Quem recebe vem do cadastro da vendedora: atendente da Nexa → a empresa paga à Nexa (que
 * repassa à atendente o percentual da plataforma); senão, a própria vendedora. A IA → Nexa.
 */
import type { RevenueAllocation } from "@/lib/recebido";

export const CATEGORIA_COMISSAO = "Comissões";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 5º dia útil (seg–sex) do mês seguinte ao de competência ("2026-10" → "2026-11-07"). */
export function quintoDiaUtil(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1));
  let uteis = 0;
  for (;;) {
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6) uteis++;
    if (uteis === 5) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

/** Chave da despesa de comissão (uma por vendedora e mês: o banco recusa repetida). */
export function referenciaComissao(salespersonId: string, mes: string): string {
  return `comissao:${salespersonId}:${mes}`;
}

/** Despesa de comissão lançada por "Marcar como paga": fica fora das despesas do DRE (a
 *  comissão já entra calculada sobre o recebido). */
export function despesaDeComissao(e: { reference_key?: string | null }): boolean {
  return (e.reference_key ?? "").startsWith("comissao:");
}

export type LinhaComissao = {
  paymentId: string | null;
  workOrderId: string;
  osNumber: string;
  dataRecebimento: string | null;
  recebido: number;
  pct: number;
  comissao: number;
};

export type ComissaoVendedora = {
  salespersonId: string;
  nome: string;
  /** A empresa paga à Nexa (atendente da Nexa ou IA). */
  viaNexa: boolean;
  ia: boolean;
  linhas: LinhaComissao[];
  recebido: number;
  comissao: number;
};

/** Comissões do mês por vendedora, a partir do recebido do mês (pela data do pagamento). */
export function comissoesDoMes(alocacoes: RevenueAllocation[]): ComissaoVendedora[] {
  const mapa = new Map<string, ComissaoVendedora>();
  for (const a of alocacoes) {
    if (!a.salespersonId || !(a.commissionPct > 0) || a.receivedGross === 0) continue;
    const comissao = r2((a.receivedGross * a.commissionPct) / 100);
    const v = mapa.get(a.salespersonId) ?? {
      salespersonId: a.salespersonId,
      nome: a.salesperson,
      viaNexa: a.salespersonNexa || a.salespersonIa,
      ia: a.salespersonIa,
      linhas: [],
      recebido: 0,
      comissao: 0,
    };
    v.linhas.push({
      paymentId: a.paymentId,
      workOrderId: a.workOrderId,
      osNumber: a.osNumber,
      dataRecebimento: a.paymentDate,
      recebido: a.receivedGross,
      pct: a.commissionPct,
      comissao,
    });
    v.recebido = r2(v.recebido + a.receivedGross);
    v.comissao = r2(v.comissao + comissao);
    mapa.set(a.salespersonId, v);
  }
  for (const v of mapa.values())
    v.linhas.sort(
      (x, y) =>
        (x.dataRecebimento ?? "").localeCompare(y.dataRecebimento ?? "") ||
        x.osNumber.localeCompare(y.osNumber),
    );
  return [...mapa.values()].sort((a, b) => b.comissao - a.comissao || a.nome.localeCompare(b.nome));
}

/** Despesa lançada (ou atualizada) ao marcar a comissão como paga. */
export function despesaDaComissao(c: ComissaoVendedora, mes: string, hoje: string) {
  const [a, m] = mes.split("-");
  return {
    description: `Comissão ${c.nome} — ${m}/${a}${c.viaNexa ? " (paga à Nexa)" : ""}`,
    category: CATEGORIA_COMISSAO,
    competence_date: `${mes}-01`,
    due_date: quintoDiaUtil(mes),
    payment_date: hoje,
    expected_amount: c.comissao,
    actual_amount: c.comissao,
    paid_amount: c.comissao,
    status: "Pago",
    origin: "Comissões a pagar",
    beneficiary: c.viaNexa ? "Nexa" : c.nome,
    reference_key: referenciaComissao(c.salespersonId, mes),
  };
}
