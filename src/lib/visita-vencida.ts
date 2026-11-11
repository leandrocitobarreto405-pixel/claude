/**
 * Visita vencida (11/11, pedido do dono): atendimento que passou da data sem ser concluído nem
 * remarcado vira, sozinho, tarefa P1 "remarcar" da equipe, com a mensagem pronta (texto fixo, sem
 * IA). Regras puras, sem banco. Nada aqui manda mensagem para cliente.
 *
 * Não entra: atendimento de retirada de persiana/tapete (fica aberto até a entrega) e OS cancelada,
 * concluída, excluída ou de teste.
 */

/** A regra vale para visitas marcadas a partir deste dia (o que venceu antes fica com o dono). */
export const VALE_DESDE = "2026-11-12";
/** Só olha para trás esta quantidade de dias. */
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

/** Primeiro dia que a regra olha: o maior entre o começo da regra e a janela. */
export function desdeQuando(hoje: string): string {
  const janela = somarDias(hoje, -JANELA_DIAS);
  return janela > VALE_DESDE ? janela : VALE_DESDE;
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

/** Texto da tarefa e da mensagem pronta. `horarios`: dois horários livres reais, quando há. */
export function textoVisitaVencida(o: {
  nome: string;
  osNumero: string | null;
  dia: string;
  horarios: [string, string] | null;
}): { motivo: string; mensagem: string } {
  const n = o.nome ? `, ${o.nome}` : "";
  const os = o.osNumero ? ` (OS ${o.osNumero})` : "";
  const oferta = o.horarios
    ? `Tenho ${o.horarios[0]} ou ${o.horarios[1]}. Qual fica melhor? Se preferir outro dia, me diz o período (manhã ou tarde) que eu vejo os horários.`
    : "Qual o melhor dia e período (manhã ou tarde) pra você? Eu já vejo os horários livres.";
  return {
    motivo: `URGENTE: a visita de ${dataCurta(o.dia)}${os} passou da data sem conclusão nem nova data: remarcar. Se o serviço foi feito, conclua a OS no app.`,
    mensagem: `Oi${n}! Tudo bem? A sua visita do dia ${dataCurta(o.dia)} ficou pendente e quero remarcar com você. ${oferta}`,
  };
}
