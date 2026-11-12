/**
 * Alice fora do ar (plano "Alice e vendas", item 11, 12/11): push só para o admin quando a Alice
 * para de responder (conta da IA sem crédito, chave recusada, Alice desligada, erro ou fila parada)
 * e há cliente esperando. Regras puras, sem banco. Nada aqui manda mensagem para cliente.
 */

import { tempoDeEspera } from "./transferencia";

/** Cliente esperando a Alice há mais do que isto conta como "sem resposta". */
export const ESPERA_MIN = 10;
/** O push se repete neste intervalo enquanto a situação durar. */
export const REPETIR_MIN = 15;
/** Só olha o que aconteceu nas últimas horas (o resto já virou assunto da equipe). */
export const JANELA_HORAS = 3;

export type CausaForaDoAr = "credito" | "autenticacao" | "desligada" | "fila";

export type TarefaDaAlice = {
  conversa_id: string;
  situacao: string;
  executar_apos: string | null;
  created_at: string;
};

/**
 * Conversas em que a Alice devia ter respondido e não respondeu: a tarefa de resposta mais recente
 * deu erro, ou está na fila (ou travada no meio) há mais de 10 minutos. Devolve a conversa e desde
 * quando o cliente espera.
 */
export function conversasSemResposta(
  tarefas: TarefaDaAlice[],
  agora: Date,
): Array<{ conversaId: string; desde: string }> {
  const ultima = new Map<string, TarefaDaAlice>();
  for (const t of tarefas) {
    const atual = ultima.get(t.conversa_id);
    if (!atual || Date.parse(t.created_at) > Date.parse(atual.created_at))
      ultima.set(t.conversa_id, t);
  }
  const limite = agora.getTime() - ESPERA_MIN * 60_000;
  const saida: Array<{ conversaId: string; desde: string }> = [];
  for (const t of ultima.values()) {
    const devida = t.executar_apos ?? t.created_at;
    const parada =
      t.situacao === "erro" ||
      ((t.situacao === "pendente" || t.situacao === "processando") && Date.parse(devida) <= limite);
    if (parada && Date.parse(devida) <= limite)
      saida.push({ conversaId: t.conversa_id, desde: devida });
  }
  return saida.sort((a, b) => a.desde.localeCompare(b.desde));
}

/** A causa mais específica que se conhece. */
export function causaForaDoAr(o: {
  parada: "credito" | "autenticacao" | null;
  ligada: boolean;
}): CausaForaDoAr {
  if (o.parada) return o.parada;
  return o.ligada ? "fila" : "desligada";
}

const CAUSA: Record<CausaForaDoAr, string> = {
  credito: "A conta da IA está sem crédito.",
  autenticacao: "A chave da IA foi recusada.",
  desligada: "A Alice está desligada nas Configurações.",
  fila: "A Alice não está respondendo (erro ou fila parada).",
};

export function textoForaDoAr(o: {
  causa: CausaForaDoAr;
  /** Clientes esperando a Alice agora. */
  esperando: number;
  /** Minutos de espera do cliente mais antigo (0 = não se sabe). */
  minutos: number;
  /** Conversas que já foram para a equipe por causa da parada. */
  comAEquipe: number;
}): { titulo: string; corpo: string } {
  const n = o.esperando + o.comAEquipe;
  const partes = [CAUSA[o.causa]];
  if (o.esperando)
    partes.push(
      `${o.esperando} ${o.esperando === 1 ? "cliente está" : "clientes estão"} sem resposta${o.minutos ? ` (o mais antigo há ${tempoDeEspera(o.minutos)})` : ""}.`,
    );
  if (o.comAEquipe)
    partes.push(
      `${o.comAEquipe} ${o.comAEquipe === 1 ? "conversa foi" : "conversas foram"} para a equipe.`,
    );
  return {
    titulo: `🔴 Alice fora do ar: ${n} ${n === 1 ? "cliente esperando" : "clientes esperando"}`,
    corpo: partes.join(" "),
  };
}

const TZ = "America/Sao_Paulo";
const horaSP = (d: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d),
  );
const diaSP = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: TZ });

/**
 * Referência do push (o registro de envios não repete a mesma referência para a mesma pessoa):
 * - de dia (8h às 21h): uma a cada 15 minutos enquanto durar;
 * - de noite (21h às 7h): uma só por noite, quando acontecer;
 * - às 7h: mais uma, se continuar fora do ar.
 */
export function referenciaDoAviso(agora: Date): string {
  const h = horaSP(agora);
  if (h >= 8 && h < 21)
    return `fora-do-ar:15:${Math.floor(agora.getTime() / (REPETIR_MIN * 60_000))}`;
  if (h === 7) return `fora-do-ar:7h:${diaSP(agora)}`;
  // A noite leva a data do dia em que começou (21h): de madrugada, o dia anterior.
  const noite = h >= 21 ? agora : new Date(agora.getTime() - 12 * 3_600_000);
  return `fora-do-ar:noite:${diaSP(noite)}`;
}
