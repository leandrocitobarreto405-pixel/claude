/**
 * Comissões a pagar (todas as empresas). Competência = mês em que o valor do serviço foi RECEBIDO
 * (pagamento Pago/Parcialmente pago, pela data do pagamento); base = valor cheio pago pelo
 * cliente, inclusive a parte do parceiro; percentual = o gravado na OS. Pagamento no 5º dia útil
 * do mês seguinte (segunda a sexta, pulando os feriados nacionais).
 * Quem recebe vem do cadastro da vendedora: atendente da Nexa → a empresa paga à Nexa (que
 * repassa à atendente o percentual da plataforma); senão, a própria vendedora. A IA → Nexa.
 */
import type { RevenueAllocation } from "@/lib/recebido";

export const CATEGORIA_COMISSAO = "Comissões";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), em UTC. */
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/**
 * Feriados nacionais (decisão de 23/10/2026): 1º/1, Paixão de Cristo, 21/4, 1º/5, 7/9, 12/10,
 * 2/11, 15/11, 20/11 e 25/12. Carnaval e Corpus Christi são ponto facultativo e não entram;
 * feriados estaduais e municipais também não.
 */
export function feriadosNacionais(ano: number): Set<string> {
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
  const paixao = new Date(pascoa(ano).getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  return new Set([...fixos.map((f) => `${ano}-${f}`), paixao]);
}

/**
 * 5º dia útil do mês seguinte ao de competência: segunda a sexta, pulando os feriados nacionais
 * ("2026-10" → "2026-11-09", porque 2/11 é Finados).
 */
export function quintoDiaUtil(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1));
  const feriados = feriadosNacionais(d.getUTCFullYear());
  let uteis = 0;
  for (;;) {
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6 && !feriados.has(d.toISOString().slice(0, 10))) uteis++;
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
