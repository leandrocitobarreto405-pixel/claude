// Agenda do dia seguinte no WhatsApp de cada técnico (sem banco, para testar). O texto é o da
// "Mensagem de amanhã" (Confirmar amanhã › Copiar todas) só com os serviços daquele técnico.
// Fora da janela de 24 h vai o modelo curto agenda_tecnico_dia com o botão "Ver agenda"; o texto
// sai quando o técnico toca no botão ou responde. Não usa IA.
import type { FormModelo } from "@/lib/modelos-mensagem";

export const NOME_MODELO_AGENDA = "agenda_tecnico_dia";
export const IDIOMA_MODELO_AGENDA = "pt_BR";
export const CORPO_MODELO_AGENDA =
  'Olá, {{1}}! Sua agenda de amanhã ({{2}}) está pronta, com {{3}} atendimento(s). Toque em "Ver agenda" para receber os horários e endereços.';
export const RODAPE_MODELO_AGENDA = "Mensagem automática da agenda";
export const BOTAO_MODELO_AGENDA = "Ver agenda";
export const EXEMPLOS_MODELO_AGENDA = ["Josué", "sexta, 24/10", "2"];

/** O mesmo modelo para toda empresa (cada uma cadastra no próprio número). */
export function formularioModeloAgenda(): FormModelo {
  return {
    nome: NOME_MODELO_AGENDA,
    idioma: IDIOMA_MODELO_AGENDA,
    categoria: "UTILITY",
    cabecalho: "",
    corpo: CORPO_MODELO_AGENDA,
    exemplos: [...EXEMPLOS_MODELO_AGENDA],
    rodape: RODAPE_MODELO_AGENDA,
    botoes: [{ tipo: "QUICK_REPLY", texto: BOTAO_MODELO_AGENDA }],
  };
}

/** Separador do "Copiar todas" (Confirmar amanhã). */
export const SEPARADOR_MENSAGENS = "\n\n———\n\n";

export function textoDaAgenda(mensagens: string[]): string {
  return mensagens.join(SEPARADOR_MENSAGENS);
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "2026-10-24" → "sexta, 24/10". */
export function diaCurto(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const semana = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? "";
  return `${semana}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

/** Variáveis do modelo: {{1}} primeiro nome, {{2}} dia, {{3}} nº de atendimentos. */
export function variaveisModeloAgenda(nome: string, dia: string, atendimentos: number) {
  return { "1": primeiroNome(nome), "2": diaCurto(dia), "3": String(atendimentos) };
}

/** Texto que o técnico lê no modelo (o que fica gravado na conversa). */
export function textoDoModeloAgenda(nome: string, dia: string, atendimentos: number): string {
  const v = variaveisModeloAgenda(nome, dia, atendimentos);
  return CORPO_MODELO_AGENDA.replace("{{1}}", v["1"])
    .replace("{{2}}", v["2"])
    .replace("{{3}}", v["3"]);
}

export type SituacaoModeloAgenda =
  | "sem_conexao"
  | "nao_cadastrado"
  | "pendente"
  | "aprovado"
  | "rejeitado"
  | "marketing"
  | "pausado";

/** Situação do modelo no número da empresa, pelo que a Meta devolveu. */
export function situacaoModeloAgenda(
  modelo: { status?: string | null; category?: string | null } | null,
): Exclude<SituacaoModeloAgenda, "sem_conexao"> {
  if (!modelo) return "nao_cadastrado";
  const status = String(modelo.status ?? "").toUpperCase();
  const categoria = String(modelo.category ?? "").toUpperCase();
  // Reclassificado pela Meta para Marketing: não serve (custo e regras diferentes).
  if (categoria && categoria !== "UTILITY") return "marketing";
  if (status === "APPROVED") return "aprovado";
  if (status === "REJECTED") return "rejeitado";
  if (status === "PAUSED" || status === "DISABLED") return "pausado";
  return "pendente";
}

export const TEXTO_SITUACAO_MODELO: Record<SituacaoModeloAgenda, string> = {
  sem_conexao: "Conecte o WhatsApp da empresa para usar a agenda",
  nao_cadastrado: "Modelo ainda não cadastrado na Meta",
  pendente: "Modelo em análise na Meta",
  aprovado: "Modelo aprovado",
  rejeitado: "Modelo rejeitado pela Meta",
  marketing: "A Meta mudou o modelo para Marketing: não serve para a agenda. Fale com a Nexa.",
  pausado: "Modelo pausado pela Meta",
};

/** Ativar só com o modelo aprovado como Utilidade no número da própria empresa. */
export function podeAtivarAgenda(s: SituacaoModeloAgenda): boolean {
  return s === "aprovado";
}

/** "18:00" ou "18:00:00" → minutos do dia. */
export function minutosDoHorario(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Data e minutos agora em São Paulo. */
export function agoraSP(agora = new Date()): { dia: string; minutos: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "00";
  return {
    dia: `${p("year")}-${p("month")}-${p("day")}`,
    minutos: Number(p("hour")) * 60 + Number(p("minute")),
  };
}

export function diaSeguinte(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Já passou do horário de mandar a agenda de amanhã? (até 23h59 do mesmo dia) */
export function horaDeEnviar(horaConfigurada: string, agora = new Date()): boolean {
  return agoraSP(agora).minutos >= minutosDoHorario(horaConfigurada);
}

/**
 * Aviso no app: o técnico recebeu o modelo e não tocou em "Ver agenda" até as 7h do dia do
 * serviço. Um aviso por envio.
 */
export function precisaAvisoNaoAbriu(
  envio: {
    situacao: string;
    dia_agenda: string;
    aviso_nao_abriu_em: string | null;
    teste: boolean;
  },
  agora = new Date(),
): boolean {
  if (envio.teste || envio.situacao !== "aguardando" || envio.aviso_nao_abriu_em) return false;
  const sp = agoraSP(agora);
  if (sp.dia > envio.dia_agenda) return true;
  return sp.dia === envio.dia_agenda && sp.minutos >= 7 * 60;
}
