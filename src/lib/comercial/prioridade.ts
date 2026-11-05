/**
 * Prioridade e prazo das tarefas (05/11, decisão do dono). Sem corte: o que organiza é isto.
 * - P1 URGENTE (fazer agora de manhã): quase fechado; concorrente, achou caro ou negociando,
 *   aprovou e falta OS/dados, encaixe para hoje/amanhã, retorno combinado vencido, cliente
 *   realmente esperando resposta.
 * - P2 HOJE: pediu preço e não recebeu, orçamento que vence hoje, orçamento de valor alto sem
 *   resposta, acertos do app.
 * - P3: resto da sequência, pós-venda, base parada; prazo no dia marcado.
 * No banco: crm_followups.prioridade 1 = P1, 2 = P2, 3 ou mais = P3 (0 = follow-up esquecido, P1).
 */
export type Nivel = 1 | 2 | 3;

export function nivelDaTarefa(prioridade: number | null | undefined): Nivel {
  if (prioridade == null) return 3;
  if (prioridade <= 1) return 1;
  if (prioridade === 2) return 2;
  return 3;
}

export const NOME_NIVEL: Record<Nivel, string> = { 1: "P1 Urgente", 2: "P2 Hoje", 3: "P3" };

/** Prazo da tarefa para a tela ("hoje de manhã", "hoje", "dia 07/11"). */
export function prazoDaTarefa(nivel: Nivel, quando: string, hoje: string): string {
  if (nivel === 1) return "hoje de manhã";
  if (nivel === 2) return "hoje";
  const dia = diaSP(quando);
  return dia <= hoje ? "hoje" : `dia ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** Atrasada: marcada para um dia anterior a hoje ou que já voltou de ontem sem Feito. */
export function tarefaAtrasada(quando: string, hoje: string, adiamentos: number): boolean {
  return adiamentos > 0 || diaSP(quando) < hoje;
}

function diaSP(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

/** Contagem por prioridade e atrasadas (cabeçalho da lista). */
export function contarPorNivel<
  T extends { prioridade: number | null; quando: string; adiamentos: number },
>(tarefas: T[], hoje: string): { p1: number; p2: number; p3: number; atrasadas: number } {
  const c = { p1: 0, p2: 0, p3: 0, atrasadas: 0 };
  for (const t of tarefas) {
    const n = nivelDaTarefa(t.prioridade);
    if (n === 1) c.p1++;
    else if (n === 2) c.p2++;
    else c.p3++;
    if (tarefaAtrasada(t.quando, hoje, t.adiamentos)) c.atrasadas++;
  }
  return c;
}
