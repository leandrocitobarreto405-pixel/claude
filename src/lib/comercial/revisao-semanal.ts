/**
 * Revisão semanal da Tatiana (Parte D3): domingo à noite, um lote com até 30 leads da semana
 * atendidos pela Alice (mais os leads com aviso da equipe) gera as fichas e o relatório da semana,
 * que lê os avisos como sinal forte. Sugestões só com Aprovar/Recusar; nada muda na Alice.
 */
export const DESCRICAO_REVISAO = "Revisão semanal";
/** Leads da semana analisados (os mais recentes), além dos que têm aviso. */
export const LEADS_DA_SEMANA = 30;
export const MAX_LEADS_REVISAO = 40;

/** É hora da revisão: domingo em São Paulo, das 22h às 23h29. */
export function horaDaRevisao(diaDaSemanaSP: number, horaSP: string): boolean {
  return diaDaSemanaSP === 0 && horaSP >= "22:00" && horaSP < "23:30";
}

/** "Semana de dd/mm a dd/mm" (os 7 dias que terminam no domingo `dia`, AAAA-MM-DD). */
export function rotuloSemana(dia: string): string {
  const fim = new Date(`${dia}T12:00:00Z`);
  const ini = new Date(fim.getTime() - 6 * 86_400_000);
  const dm = (d: Date) => d.toISOString().slice(5, 10).split("-").reverse().join("/");
  return `Semana de ${dm(ini)} a ${dm(fim)}`;
}

/** Leads do lote: os com aviso primeiro, depois os da semana, sem repetir, até o limite. */
export function leadsDaRevisao(comAviso: string[], daSemana: string[]): string[] {
  const saida: string[] = [];
  for (const id of [...comAviso, ...daSemana.slice(0, LEADS_DA_SEMANA)])
    if (!saida.includes(id) && saida.length < MAX_LEADS_REVISAO) saida.push(id);
  return saida;
}
