/**
 * Visita vencida (11/11, ajustada em 12/11 a pedido do dono): atendimento que passou da data e
 * continua em aberto vira, sozinho, tarefa P1 da equipe que PERGUNTA se a visita foi feita, com
 * dois caminhos: "Concluir" (conclui a visita) e "Remarcar" (mensagem pronta com os próximos
 * horários livres, texto fixo, sem IA). Regras puras, sem banco. Nada aqui manda mensagem para
 * cliente.
 *
 * Vira tarefa a visita dos últimos 7 dias. As mais antigas ficam só na lista de Serviços › Para
 * concluir, para a equipe concluir ou cancelar com um toque. Não entra: atendimento de retirada de
 * persiana/tapete (fica aberto até a entrega) e OS cancelada, concluída, excluída ou de teste.
 */

/** Só vira tarefa a visita vencida há até esta quantidade de dias; antes disso é "antiga". */
export const JANELA_DIAS = 7;

/** Situações em que a visita ainda está "em aberto" no app. */
export const SITUACOES_ABERTAS = [
  "Agendado",
  "Confirmado",
  "Em deslocamento",
  "Em execução",
  "Reagendado",
] as const;

const SUBSTITUIDA = "substituído por um novo follow-up";

export type VisitaParaVencer = {
  status: string;
  scheduled_date: string;
  retirada: string | null;
};

export type OsParaVencer = {
  status?: string | null;
  deleted_at?: string | null;
  eh_teste?: boolean | null;
} | null;

export function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Primeiro dia que a regra olha. */
export function desdeQuando(hoje: string): string {
  return somarDias(hoje, -JANELA_DIAS);
}

/** Visita em aberto há mais de 7 dias: não vira tarefa, fica na lista para concluir ou cancelar. */
export function visitaAntiga(scheduledDate: string, hoje: string): boolean {
  return scheduledDate < desdeQuando(hoje);
}

// "Parcialmente concluída" continua valendo: ainda falta atendimento.
const osAtiva = (os: OsParaVencer) =>
  Boolean(os) &&
  !os!.deleted_at &&
  !os!.eh_teste &&
  !/cancel/i.test(os!.status ?? "") &&
  os!.status !== "Concluída";

/** A visita passou da data, segue em aberto e a OS continua valendo. */
export function visitaVencida(v: VisitaParaVencer, os: OsParaVencer, hoje: string): boolean {
  if (v.retirada) return false;
  if (!(SITUACOES_ABERTAS as readonly string[]).includes(v.status)) return false;
  if (v.scheduled_date >= hoje || v.scheduled_date < desdeQuando(hoje)) return false;
  return osAtiva(os);
}

export function marcaVencida(visitaId: string, dia: string): string {
  return `[vencida:${visitaId}:${dia}]`;
}

export function lerMarcaVencida(notas: string | null | undefined): {
  visitaId: string;
  dia: string;
} | null {
  const m = /\[vencida:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})\]/i.exec(notas ?? "");
  return m ? { visitaId: m[1]!, dia: m[2]! } : null;
}

/**
 * Já existe tarefa para esta visita e data? Tarefa que o sistema cancelou por causa de outro
 * follow-up na mesma conversa não conta (a de remarcar volta), até 3 vezes.
 */
export function jaTemTarefa(tarefas: Array<{ status: string; result: string | null }>): boolean {
  if (tarefas.length >= 3) return true;
  return tarefas.some((t) => !(t.status === "Cancelada" && t.result === SUBSTITUIDA));
}

/**
 * Por que a tarefa pode fechar sozinha (null = segue aberta): a visita foi concluída, cancelada,
 * mudou de data ou a OS deixou de valer.
 */
export function motivoParaFechar(
  v: (VisitaParaVencer & { os: OsParaVencer }) | null,
  diaDaTarefa: string,
): string | null {
  if (!v) return "a visita não existe mais";
  if (!osAtiva(v.os)) return "a OS foi concluída ou cancelada";
  if (v.status === "Concluído") return "a visita foi concluída";
  if (v.status === "Cancelado") return "a visita foi cancelada";
  if (v.status === "Reagendado com deslocamento" || v.scheduled_date !== diaDaTarefa)
    return "a visita foi remarcada";
  return null;
}

const dataCurta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Últimos 4 dígitos do telefone ("" quando não há). */
export function finalDoTelefone(telefone: string | null | undefined): string {
  const d = (telefone ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : "";
}

/**
 * Texto da tarefa: a pergunta ("A visita de ontem (OS nº 1719, cliente final 8473) foi feita?") e
 * a mensagem pronta do caminho "Remarcar". `horarios`: dois horários livres reais, quando há.
 */
export function textoVisitaVencida(o: {
  nome: string;
  osNumero: string | null;
  /** Final do telefone do cliente (4 dígitos) ou "". */
  final: string;
  dia: string;
  hoje: string;
  horarios: [string, string] | null;
}): { motivo: string; mensagem: string } {
  const n = o.nome ? `, ${o.nome}` : "";
  const quando = o.dia === somarDias(o.hoje, -1) ? "ontem" : dataCurta(o.dia);
  const detalhes = [
    o.osNumero ? `OS nº ${o.osNumero}` : null,
    o.final ? `cliente final ${o.final}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const oferta = o.horarios
    ? `Tenho ${o.horarios[0]} ou ${o.horarios[1]}. Qual fica melhor? Se preferir outro dia, me diz o período (manhã ou tarde) que eu vejo os horários.`
    : "Qual o melhor dia e período (manhã ou tarde) pra você? Eu já vejo os horários livres.";
  return {
    motivo: `A visita de ${quando}${detalhes ? ` (${detalhes})` : ""} foi feita?`,
    mensagem: `Oi${n}! Tudo bem? A sua visita do dia ${dataCurta(o.dia)} ficou pendente e quero remarcar com você. ${oferta}`,
  };
}
