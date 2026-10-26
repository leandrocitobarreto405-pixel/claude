/**
 * Recebido do período pela DATA DO PAGAMENTO (vale para todas as empresas): cada pagamento ativo
 * "Pago" ou "Parcialmente pago" entra no mês em que foi recebido, pelo valor efetivamente
 * recebido. É a base do DRE (receita, taxas, repasse) e das comissões.
 *  - receita (faturamento) = recebido − parte do repasse ao parceiro (itens terceirizados);
 *  - base da comissão = o valor CHEIO pago pelo cliente (o repasse NÃO sai da base);
 *  - percentual = o gravado na OS na venda; sem ele, o da vendedora. Venda da equipe Nexa
 *    (atendente da Nexa ou Alice): o % do contrato vigente na data da venda, quando há contrato.
 * Funções puras: quem busca os dados é reports.ts.
 */
import { repasseDoRecebido } from "@/lib/terceirizados";
import { vendidaPelaNexa } from "./vendido-por";

export type PagamentoRecebido = {
  id: string;
  work_order_id: string;
  visit_id: string | null;
  payment_date: string | null;
  gross_amount: number | null;
};

export type VendedoraOs = {
  id: string;
  name: string;
  atendente_nexa?: boolean | null;
  eh_ia?: boolean | null;
  commission_percentage?: number | null;
};

export type OsRecebido = {
  id: string;
  os_number: string;
  sale_date: string | null;
  customer_id: string | null;
  total_gross_value: number | null;
  commission_percentage_snapshot: number | null;
  /** "nexa" (atendente da Nexa ou Alice) ou "empresa"; sem ele, pela vendedora. */
  vendido_por?: string | null;
  /** % do contrato da Nexa vigente na data da venda (só vendas da equipe Nexa). */
  nexaPct?: number | null;
  origem: string | null;
  vendedora: VendedoraOs | null;
  visitas: Array<{
    id: string;
    status: string;
    repasse_parceiro?: number | null;
    servico: string | null;
  }>;
};

/** Um recebimento (pagamento) atribuído ao mês em que entrou no caixa. */
export type RevenueAllocation = {
  paymentId: string | null;
  paymentDate: string | null;
  visitId: string | null;
  workOrderId: string;
  osNumber: string;
  customerId: string | null;
  saleDate: string | null;
  origin: string;
  salespersonId: string | null;
  salesperson: string;
  /** Vendedora é atendente da Nexa (a comissão dela é paga à Nexa). */
  salespersonNexa: boolean;
  /** Vendedora é a IA (Alice). */
  salespersonIa: boolean;
  service: string;
  serviceValue: number;
  discount: number;
  /** Valor cheio pago pelo cliente: base da comissão (inclusive a parte do parceiro). */
  receivedGross: number;
  /** Recebido que fica com a empresa (sem a parte do repasse): faturamento. */
  received: number;
  /** Parte do repasse ao parceiro correspondente ao recebido (já descontada de `received`). */
  repasse: number;
  mileage: number;
  commissionPct: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Venda da equipe Nexa: a gravada na OS; sem ela, pela vendedora (atendente da Nexa). */
export function vendaDaNexa(os: OsRecebido | undefined): boolean {
  return vendidaPelaNexa(os);
}

export function percentualDaComissao(os: OsRecebido | undefined): number {
  if (vendaDaNexa(os) && os?.nexaPct !== null && os?.nexaPct !== undefined)
    return Number(os.nexaPct);
  const snap = os?.commission_percentage_snapshot;
  if (snap !== null && snap !== undefined) return Number(snap);
  return Number(os?.vendedora?.commission_percentage ?? 0);
}

export function alocarRecebimentos(
  pagamentos: PagamentoRecebido[],
  oss: Map<string, OsRecebido>,
): RevenueAllocation[] {
  return pagamentos
    .filter((p) => Number(p.gross_amount ?? 0) !== 0)
    .map((p) => {
      const os = oss.get(p.work_order_id);
      const gross = r2(Number(p.gross_amount ?? 0));
      const ativas = (os?.visitas ?? []).filter((v) => v.status !== "Cancelado");
      const repasseOs = ativas.reduce((s, v) => s + (Number(v.repasse_parceiro) || 0), 0);
      const repasse = repasseDoRecebido(repasseOs, Number(os?.total_gross_value ?? 0), gross);
      const visita = p.visit_id ? ativas.find((v) => v.id === p.visit_id) : undefined;
      return {
        paymentId: p.id,
        paymentDate: p.payment_date,
        visitId: p.visit_id,
        workOrderId: p.work_order_id,
        osNumber: os?.os_number ?? "",
        customerId: os?.customer_id ?? null,
        saleDate: os?.sale_date ?? null,
        origin: os?.origem ?? "Indefinida",
        salespersonId: os?.vendedora?.id ?? null,
        salesperson: os?.vendedora?.name ?? "Sem vendedora",
        salespersonNexa: vendaDaNexa(os),
        salespersonIa: os?.vendedora?.eh_ia === true,
        service: (visita ?? ativas[0])?.servico ?? "Sem serviço",
        serviceValue: r2(Number(os?.total_gross_value ?? 0)),
        discount: 0,
        receivedGross: gross,
        received: r2(gross - repasse),
        repasse,
        mileage: 0,
        commissionPct: percentualDaComissao(os),
      } satisfies RevenueAllocation;
    });
}
