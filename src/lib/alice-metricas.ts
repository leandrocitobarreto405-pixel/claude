import { repasseDaOs, valorLiquido } from "@/lib/terceirizados";

/**
 * Métricas da Alice por empresa (painel Nexa › Alice): o que ela atendeu,
 * quanto virou venda e quanto custou. Cálculo puro; a tela busca os dados.
 */

export type ExecucaoAlice = {
  crm_lead_id: string | null;
  conversa_id: string | null;
  custo_usd: number;
  mensagens_enviadas: string[] | null;
};

export type LeadAlice = {
  id: string;
  orcamento_em: string | null;
  os_criada_em: string | null;
  /** OS ligada ao lead (null quando não há, foi cancelada, excluída ou é de teste). */
  valor_os: number | null;
};

export type MetricasAlice = {
  execucoes: number;
  conversas: number;
  mensagens: number;
  /** Leads a quem a Alice mandou ao menos uma mensagem no período. */
  leadsAtendidos: number;
  chegaramOrcamento: number;
  vendidos: number;
  valorVendido: number;
  custoUsd: number;
  custoPorConversaUsd: number;
  custoPorMensagemUsd: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function resumirAlice(execucoes: ExecucaoAlice[], leads: LeadAlice[]): MetricasAlice {
  const conversas = new Set<string>();
  const atendidos = new Set<string>();
  let mensagens = 0;
  let custo = 0;
  for (const e of execucoes) {
    if (e.conversa_id) conversas.add(e.conversa_id);
    const n = e.mensagens_enviadas?.length ?? 0;
    mensagens += n;
    custo += Number(e.custo_usd) || 0;
    if (n > 0 && e.crm_lead_id) atendidos.add(e.crm_lead_id);
  }
  let chegaramOrcamento = 0;
  let vendidos = 0;
  let valorVendido = 0;
  for (const l of leads) {
    if (!atendidos.has(l.id)) continue;
    if (l.orcamento_em) chegaramOrcamento++;
    if (l.os_criada_em && l.valor_os !== null) {
      vendidos++;
      valorVendido += l.valor_os;
    }
  }
  return {
    execucoes: execucoes.length,
    conversas: conversas.size,
    mensagens,
    leadsAtendidos: atendidos.size,
    chegaramOrcamento,
    vendidos,
    valorVendido: r2(valorVendido),
    custoUsd: r4(custo),
    custoPorConversaUsd: conversas.size ? r4(custo / conversas.size) : 0,
    custoPorMensagemUsd: mensagens ? r4(custo / mensagens) : 0,
  };
}

/**
 * Valor da OS que conta como venda: não cancelada, não excluída e não de teste, já sem o
 * repasse a parceiros dos itens terceirizados.
 */
export function valorOsVendida(
  os: {
    total_gross_value: number | null;
    eh_teste: boolean | null;
    cancelled_at: string | null;
    deleted_at: string | null;
    visits?: { repasse_parceiro?: number | null }[] | null;
  } | null,
): number | null {
  if (!os || os.eh_teste || os.cancelled_at || os.deleted_at) return null;
  return valorLiquido(Number(os.total_gross_value) || 0, repasseDaOs(os.visits ?? null));
}

/** Percentual de a sobre b, para "x de y (z%)". */
export function taxa(a: number, b: number): string {
  if (!b) return "—";
  return `${Math.round((a / b) * 100)}%`;
}
