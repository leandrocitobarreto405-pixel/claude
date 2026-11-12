/**
 * Transferência da Alice para a equipe com prazo e alarme (plano "Alice e vendas", item 7, 12/11).
 * A Alice só diz "já te retorno" com prazo, e o prazo vira alarme: push para a equipe a cada 5
 * minutos até alguém responder na conversa, no horário de atendimento. Fora do horário, a
 * transferência vira a primeira tarefa da manhã. Regras puras, sem banco. Nada aqui manda mensagem.
 */
import { emHorarioUtil, proximoHorarioUtil, type HorarioUtil } from "@/lib/comercial/furos";

/** De quantos em quantos minutos o push se repete enquanto ninguém responde. */
export const INTERVALO_ALARME_MIN = 5;

export type PrazoDaTransferencia = {
  foraDoHorario: boolean;
  /** Quando a equipe deve ter respondido (no horário) ou quando o atendimento abre (fora dele). */
  prazoEm: string;
  /** Como a Alice diz o prazo ao cliente: "em até 10 minutos", "logo cedo amanhã". */
  frase: string;
};

const diaSP = (d: Date | string) =>
  new Date(d).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const DIAS = [
  "no domingo",
  "na segunda-feira",
  "na terça-feira",
  "na quarta-feira",
  "na quinta-feira",
  "na sexta-feira",
  "no sábado",
];

/** O prazo que a Alice diz ao cliente e que vira o alarme. */
export function prazoDaTransferencia(
  agora: Date,
  horario: HorarioUtil,
  prazoMin: number,
): PrazoDaTransferencia {
  if (emHorarioUtil(agora, horario))
    return {
      foraDoHorario: false,
      prazoEm: new Date(agora.getTime() + prazoMin * 60_000).toISOString(),
      frase: `em até ${prazoMin} minutos`,
    };
  const abre = proximoHorarioUtil(agora.toISOString(), horario);
  const hoje = diaSP(agora);
  const dia = diaSP(abre);
  const amanha = diaSP(new Date(Date.parse(`${hoje}T12:00:00Z`) + 86_400_000));
  const frase =
    dia === hoje
      ? "hoje logo cedo"
      : dia === amanha
        ? "logo cedo amanhã"
        : `logo cedo ${DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()]}`;
  return { foraDoHorario: true, prazoEm: abre, frase };
}

/** A frase que a Alice diz ao cliente ao transferir (texto aprovado pelo dono). */
export function fraseDaTransferencia(atendente: string | null, prazo: PrazoDaTransferencia) {
  const quem = atendente ? `a ${atendente}, nossa especialista,` : "a nossa especialista";
  return `Vou chamar ${quem} e ela te responde ${prazo.frase}, tá bom? Ela já está com todas as informações aqui 💙`;
}

/** Encaixe na agenda: a Alice não chama ninguém, ela mesma promete voltar no prazo. */
export function fraseDoEncaixe(prazo: PrazoDaTransferencia) {
  return prazo.foraDoHorario
    ? `Vou ver com a equipe se consigo um encaixe pra você e te retorno ${prazo.frase}, tá bom? 💙`
    : `Vou ver agora com a equipe se consigo um encaixe pra você e te retorno ${prazo.frase}, tá bom? 💙`;
}

/** A frase certa para o motivo da transferência. */
export function fraseParaOCliente(
  motivo: string,
  atendente: string | null,
  prazo: PrazoDaTransferencia,
) {
  return categoriaDoMotivo(motivo) === "encaixe"
    ? fraseDoEncaixe(prazo)
    : fraseDaTransferencia(atendente, prazo);
}

export type MensagemDaConversa = {
  direction: string | null;
  remetente_tipo: string | null;
  privada: boolean | null;
  message_timestamp: string;
};

/**
 * Quando a equipe respondeu na conversa depois da transferência (ISO) ou null. Só conta mensagem
 * de uma pessoa da equipe para o cliente: nota interna, a Alice e campanha não contam.
 */
export function respostaDaEquipe(mensagens: MensagemDaConversa[], criadaEm: string): string | null {
  const desde = Date.parse(criadaEm);
  let primeira: string | null = null;
  for (const m of mensagens) {
    if (m.privada || m.direction !== "Enviada" || m.remetente_tipo !== "user") continue;
    const t = Date.parse(m.message_timestamp);
    if (Number.isNaN(t) || t <= desde) continue;
    if (!primeira || t < Date.parse(primeira)) primeira = m.message_timestamp;
  }
  return primeira;
}

export type TransferenciaAberta = {
  criadaEm: string;
  prazoEm: string | null;
  foraDoHorario: boolean;
  ultimoPushEm: string | null;
};

/**
 * É hora de mandar o push do alarme? Só no horário de atendimento, de 5 em 5 minutos. O primeiro
 * sai 5 minutos depois da transferência (o push "conversa nova" já saiu na hora); a transferência
 * feita fora do horário alarma assim que o atendimento abre.
 */
export function horaDoAlarme(t: TransferenciaAberta, agora: Date, horario: HorarioUtil): boolean {
  if (!emHorarioUtil(agora, horario)) return false;
  const intervalo = INTERVALO_ALARME_MIN * 60_000;
  if (t.ultimoPushEm) return agora.getTime() - Date.parse(t.ultimoPushEm) >= intervalo - 30_000;
  if (t.foraDoHorario) return !t.prazoEm || agora.getTime() >= Date.parse(t.prazoEm);
  return agora.getTime() - Date.parse(t.criadaEm) >= intervalo - 30_000;
}

/** Minutos de espera para mostrar: no horário, desde a transferência; fora dele, desde a abertura. */
export function minutosEsperando(t: TransferenciaAberta, agora: Date): number {
  const desde =
    t.foraDoHorario && t.prazoEm && Date.parse(t.prazoEm) > Date.parse(t.criadaEm)
      ? Math.min(agora.getTime(), Math.max(Date.parse(t.prazoEm), Date.parse(t.criadaEm)))
      : Date.parse(t.criadaEm);
  return Math.max(0, Math.floor((agora.getTime() - desde) / 60_000));
}

/** "8 min", "1h05", "3h": tempo de espera para o push e para a tela. */
export function tempoDeEspera(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export function textoDoAlarme(o: {
  nome: string;
  final: string;
  motivo: string;
  minutos: number;
  foraDoHorario: boolean;
}): { titulo: string; corpo: string } {
  const quem = `${o.nome || "Cliente"}${o.final ? ` (final ${o.final})` : ""}`;
  const quando = o.foraDoHorario
    ? "A Alice transferiu fora do horário"
    : `A Alice transferiu há ${tempoDeEspera(o.minutos)}`;
  return {
    titulo: `🔴 Cliente esperando: ${quem}`,
    corpo: `${quando} (${o.motivo}). Ninguém respondeu ainda.`,
  };
}

/** Motivo da tarefa da manhã, quando a transferência acontece fora do horário. */
export function motivoDaTarefaDaManha(motivo: string, valorSugerido: number | null): string {
  const valor =
    valorSugerido === null
      ? ""
      : ` Valor sugerido: ${valorSugerido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`;
  return `A Alice transferiu fora do horário (${motivo}) e disse ao cliente que a resposta vem logo cedo.${valor} Responder primeiro.`.slice(
    0,
    300,
  );
}

/** Motivo resumido para a medição ("encaixe", "desconto", "concorrência", "item fora da tabela"…). */
export function categoriaDoMotivo(motivo: string): string {
  const m = motivo.toLowerCase();
  if (/encaixe/.test(m)) return "encaixe";
  if (/concorr|outra empresa|mais barat/.test(m)) return "concorrencia";
  if (/desconto|pre[cç]o/.test(m)) return "desconto";
  if (/fora da [aá]rea/.test(m)) return "fora_da_area";
  if (/tabela|item/.test(m)) return "item_fora_da_tabela";
  if (/remarca|reserv|agenda|hor[aá]rio/.test(m)) return "agenda";
  if (/p[oó]s-venda|reclama|problema/.test(m)) return "pos_venda";
  if (/humano|pessoa|atendente/.test(m)) return "pediu_pessoa";
  return "outro";
}
