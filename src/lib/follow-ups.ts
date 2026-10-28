/**
 * Follow-ups (Vendas, 29/10): retornos e toques da equipe e da Alice numa lista só, com o destino
 * em um toque. Retorno vencido não some: fica em "Hoje e vencidos", em vermelho, com os dias de
 * atraso (o banco marca "Vencida" depois de 3 dias, mas a lista continua mostrando). Só a parte
 * pura; a leitura do banco fica na tela.
 */
import { diaSP } from "@/lib/retornos";

export const ABAS_FOLLOWUPS = [
  { id: "hoje", rotulo: "Hoje e vencidos" },
  { id: "proximos", rotulo: "Próximos" },
  { id: "sem-desfecho", rotulo: "Sem desfecho" },
  { id: "sem-resposta", rotulo: "Sem resposta 3+ dias" },
  { id: "site", rotulo: "Do site" },
] as const;
export type AbaFollowups = (typeof ABAS_FOLLOWUPS)[number]["id"];

export function ehAbaFollowups(a: unknown): a is AbaFollowups {
  return ABAS_FOLLOWUPS.some((x) => x.id === a);
}

export type ItemFollowup = {
  id: string;
  leadId: string | null;
  scheduledAt: string;
  status: string;
  responsavel: "alice" | "equipe";
  /** Pessoa da equipe com o retorno (assigned_to); null = sem dono. */
  pessoaId: string | null;
  comOrcamento: boolean;
};

export type FiltrosFollowups = {
  orcamento: "todos" | "com" | "sem";
  quem: "todos" | "alice" | "equipe";
  /** id da pessoa ou "todas". */
  pessoa: string;
};

export const FILTROS_PADRAO: FiltrosFollowups = {
  orcamento: "todos",
  quem: "todos",
  pessoa: "todas",
};

/** Dias de atraso pelo dia de São Paulo (0 = hoje ou no futuro). */
export function diasDeAtraso(scheduledAt: string, agora: Date): number {
  const hoje = Date.parse(`${diaSP(agora.toISOString())}T12:00:00Z`);
  const dia = Date.parse(`${diaSP(scheduledAt)}T12:00:00Z`);
  return Math.max(0, Math.round((hoje - dia) / 86_400_000));
}

/** "Hoje e vencidos" (até o fim de hoje, sem limite de dias) ou "Próximos". */
export function abaDoItem(i: Pick<ItemFollowup, "scheduledAt">, agora: Date): "hoje" | "proximos" {
  return diaSP(i.scheduledAt) <= diaSP(agora.toISOString()) ? "hoje" : "proximos";
}

export function filtrarFollowups<T extends ItemFollowup>(lista: T[], f: FiltrosFollowups): T[] {
  return lista.filter(
    (i) =>
      (f.orcamento === "todos" || (f.orcamento === "com") === i.comOrcamento) &&
      (f.quem === "todos" || i.responsavel === f.quem) &&
      (f.pessoa === "todas" || i.pessoaId === f.pessoa || i.pessoaId === null),
  );
}

/** Vencidos primeiro (mais atrasado no topo), depois pelo horário; equipe antes da Alice. */
export function ordenarFollowups<T extends ItemFollowup>(lista: T[], agora: Date): T[] {
  return [...lista].sort(
    (a, b) =>
      diasDeAtraso(b.scheduledAt, agora) - diasDeAtraso(a.scheduledAt, agora) ||
      (a.responsavel === b.responsavel ? 0 : a.responsavel === "equipe" ? -1 : 1) ||
      a.scheduledAt.localeCompare(b.scheduledAt),
  );
}

/** Texto do atraso: "Vencido há 1 dia", "Vencido há 5 dias"; null se é de hoje ou futuro. */
export function textoAtraso(dias: number): string | null {
  if (dias <= 0) return null;
  return `Vencido há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}
