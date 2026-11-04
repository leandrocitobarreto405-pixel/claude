/**
 * Tatiana, furos do acompanhamento (01/11/2026): regras puras, sem banco. Próxima olhada
 * (rever_em) de cada decisão, horário de atendimento da empresa (tarefas só em dia/hora útil),
 * quem entra na noite e por quê, tarefa que voltou ("pendente de ontem"), tipos de tarefa e os
 * textos das tarefas que o sistema cria sem a IA (pós-venda, remarcar, lead do site).
 */
import type { Caixinha, DecisaoIA } from "./tatiana";

// ---------------------------------------------------------------- tipos de tarefa

export const TIPOS_TAREFA = [
  "mensagem",
  "ligar",
  "follow_up_esquecido",
  "remarcar",
  "pos_venda",
  "lead_site",
] as const;
export type TipoTarefa = (typeof TIPOS_TAREFA)[number];

export const ROTULO_TAREFA: Record<TipoTarefa, string> = {
  mensagem: "Mensagem",
  ligar: "Ligar",
  follow_up_esquecido: "Follow-up esquecido",
  remarcar: "Remarcar",
  pos_venda: "Pós-venda",
  lead_site: "Lead do site",
};

export function tipoTarefa(v: string | null | undefined): TipoTarefa {
  return (TIPOS_TAREFA as readonly string[]).includes(v ?? "") ? (v as TipoTarefa) : "mensagem";
}

// ---------------------------------------------------------------- horário de atendimento

/**
 * Dias da semana (0 = domingo … 6 = sábado) e horas "HH:MM", em São Paulo. `bloqueados`: dias
 * (AAAA-MM-DD) que não contam como úteis (feriado sem "vamos trabalhar", 02/11).
 */
export type HorarioUtil = { dias: number[]; inicio: string; fim: string; bloqueados?: string[] };
export const HORARIO_PADRAO: HorarioUtil = {
  dias: [1, 2, 3, 4, 5, 6],
  inicio: "08:00",
  fim: "19:00",
};

const SP_MS = 3 * 3_600_000;

/** Partes de um instante em São Paulo (sem horário de verão desde 2019: sempre −03:00). */
export function partesSP(iso: string | Date): { dia: string; hm: string; diaSemana: number } {
  const t = (typeof iso === "string" ? Date.parse(iso) : iso.getTime()) - SP_MS;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    dia: d.toISOString().slice(0, 10),
    hm: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
    diaSemana: d.getUTCDay(),
  };
}

/** ISO de um dia e hora de São Paulo. */
export const isoSP = (dia: string, hm: string) => new Date(`${dia}T${hm}:00-03:00`).toISOString();

const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Horário de atendimento da empresa (sem configuração: seg–sáb 8h–19h). */
export function horarioDaConfig(
  c: { dias_uteis?: number[] | null; hora_inicio?: string | null; hora_fim?: string | null } | null,
  bloqueados?: string[] | null,
): HorarioUtil {
  return {
    dias: c?.dias_uteis?.length ? c.dias_uteis.map(Number) : HORARIO_PADRAO.dias,
    inicio: (c?.hora_inicio ?? HORARIO_PADRAO.inicio).slice(0, 5),
    fim: (c?.hora_fim ?? HORARIO_PADRAO.fim).slice(0, 5),
    ...(bloqueados?.length ? { bloqueados } : {}),
  };
}

/** O dia conta como útil: cai nos dias da empresa e não está bloqueado (feriado). */
export function diaUtil(h: HorarioUtil, dia: string): boolean {
  const dias = h.dias.length ? h.dias : HORARIO_PADRAO.dias;
  return dias.includes(partesSP(`${dia}T12:00:00-03:00`).diaSemana) && !h.bloqueados?.includes(dia);
}

export function emHorarioUtil(iso: string | Date, h: HorarioUtil = HORARIO_PADRAO): boolean {
  const { dia, hm } = partesSP(iso);
  return diaUtil(h, dia) && hm >= h.inicio && hm < h.fim;
}

/** O mesmo instante, se for útil; senão o começo do próximo horário útil (até 15 dias à frente). */
export function proximoHorarioUtil(iso: string, h: HorarioUtil = HORARIO_PADRAO): string {
  const { dia, hm } = partesSP(iso);
  if (diaUtil(h, dia)) {
    if (hm >= h.inicio && hm < h.fim) return iso;
    if (hm < h.inicio) return isoSP(dia, h.inicio);
  }
  for (let i = 1; i <= 15; i++) {
    const d = somarDias(dia, i);
    if (diaUtil(h, d)) return isoSP(d, h.inicio);
  }
  return iso;
}

/** Minutos dentro do horário de atendimento entre dois instantes (até 7 dias). */
export function minutosUteis(
  desdeIso: string,
  agora: Date,
  h: HorarioUtil = HORARIO_PADRAO,
): number {
  const ini = Date.parse(desdeIso);
  const fim = agora.getTime();
  if (!(fim > ini)) return 0;
  let total = 0;
  const { dia } = partesSP(desdeIso);
  for (let i = 0; i <= 7; i++) {
    const d = somarDias(dia, i);
    if (!diaUtil(h, d)) continue;
    const a = Math.max(ini, Date.parse(isoSP(d, h.inicio)));
    const b = Math.min(fim, Date.parse(isoSP(d, h.fim)));
    if (b > a) total += (b - a) / 60_000;
    if (Date.parse(isoSP(d, h.fim)) >= fim) break;
  }
  return Math.floor(total);
}

// ---------------------------------------------------------------- próxima olhada (rever_em)

/** Dia (AAAA-MM-DD, São Paulo) em que a Tatiana olha o lead de novo; null = sem revisão. */
export function diaDeRever(o: {
  acao: DecisaoIA["acao"];
  /** Data da tarefa (chamar), do evento (agendar) ou combinada (esperar), ISO; null = sem data. */
  quando: string | null;
  hoje: string;
}): string | null {
  const dia = o.quando ? partesSP(o.quando).dia : null;
  const depoisDeHoje = (d: string) => (d > o.hoje ? d : somarDias(o.hoje, 1));
  switch (o.acao) {
    case "chamar":
      return depoisDeHoje(somarDias(dia ?? o.hoje, 1));
    case "agendar":
      return depoisDeHoje(somarDias(dia ?? somarDias(o.hoje, 2), -1));
    case "esperar":
      return depoisDeHoje(dia ?? somarDias(o.hoje, 7));
    case "parar":
      return null;
  }
}

/** rever_em gravado: começo do dia em São Paulo. */
export const reverEmIso = (dia: string | null) => (dia ? isoSP(dia, "00:00") : null);

// ---------------------------------------------------------------- quem entra na noite

export type MotivoEntrada = "mensagem" | "rever" | "seguranca";

/**
 * Por que o lead entra na noite: (a) qualquer mensagem no dia (de qualquer lado, menos disparos
 * de campanha), (b) próxima olhada chegou, (c) rede de segurança: aberto nas caixinhas 2–5 sem
 * toque futuro e sem próxima olhada. Lead fechado/perdido só entra por mensagem (acertos).
 */
export function motivosDeEntrada(l: {
  aberto: boolean;
  perdido: boolean;
  mensagemNoDia: boolean;
  reverEm: string | null;
  caixinha: number | null;
  toqueFuturo: boolean;
  hoje: string;
}): MotivoEntrada[] {
  if (l.perdido) return [];
  const m: MotivoEntrada[] = [];
  if (l.mensagemNoDia) m.push("mensagem");
  if (!l.aberto) return m;
  if (l.reverEm && partesSP(l.reverEm).dia <= l.hoje) m.push("rever");
  if (
    !l.reverEm &&
    !l.toqueFuturo &&
    l.caixinha !== null &&
    l.caixinha >= 2 &&
    l.caixinha <= 5 &&
    !m.includes("mensagem")
  )
    m.push("seguranca");
  return m;
}

/**
 * Lead criado por campanha/disparo que nunca respondeu (04/11): não é "lead sem desfecho" e não
 * entra na leitura da noite; fica nas listas de campanha. Respondeu (respondeu_em gravado pela
 * primeira mensagem recebida): vira lead normal. Contato iniciado à mão pela equipe não conta.
 */
export function campanhaSemResposta(l: {
  entrada: string | null;
  respondeuEm: string | null;
  recebeuDisparo: boolean;
}): boolean {
  return l.entrada === "ativo" && !l.respondeuEm && l.recebeuDisparo;
}

/** Lacuna para preencher na mensagem ("R$ ___", "[nome]", "{{1}}", "R$ X"): nunca sai pronta. */
const LACUNA = /_{2,}|R\$\s*(?:[_?]|x{1,3}\b|\.{2,})|\[[^\]\n]{1,60}\]|\{\{[^}]*\}\}|\bX{2,}\b/i;
export function temLacuna(texto: string | null | undefined): boolean {
  return Boolean(texto && LACUNA.test(texto));
}
export const MOTIVO_LACUNA = "Montar o orçamento e mandar o valor";

/** Caixinhas finalizadas (comprou, fechou com outra, fora da área, descartado): fora da leitura. */
export const CAIXINHAS_FINALIZADAS = new Set([1, 7, 8, 9]);

/**
 * Finalizado entra na noite? Nunca (04/11). Única exceção: comprou (1) com OS e mensagem nova,
 * só para os acertos da OS (visita, pagamento), sem tarefa de venda.
 */
export function finalizadoFora(l: {
  caixinha: number | null;
  temOs: boolean;
  mensagemNoDia: boolean;
}): boolean {
  if (l.caixinha === null || !CAIXINHAS_FINALIZADAS.has(l.caixinha)) return false;
  return !(l.caixinha === 1 && l.temOs && l.mensagemNoDia);
}

/**
 * Guardado para campanha (04/11): sai da leitura e fica nas listas. Volta quando o cliente manda
 * mensagem depois de guardado.
 */
export function guardadoFora(l: { guardadoEm: string | null; clienteFalouDepois: boolean }) {
  return Boolean(l.guardadoEm) && !l.clienteFalouDepois;
}

/** Toque (de qualquer um) vencido há mais de 12 h que ninguém fez: follow-up esquecido. */
export function followUpEsquecido(
  toquesVencidos: Array<{ scheduledAt: string; status: string }>,
  agora: Date,
): string | null {
  const v = toquesVencidos
    .filter((t) => t.status === "Pendente")
    .filter((t) => agora.getTime() - Date.parse(t.scheduledAt) > 12 * 3_600_000)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  return v ? v.scheduledAt : null;
}

// ---------------------------------------------------------------- tarefa que voltou

/** Tarefa sem Feito/Pular até o fim do dia: volta amanhã com prioridade maior. */
export function adiarTarefa(t: { prioridade: number | null; adiamentos: number }): {
  prioridade: number;
  adiamentos: number;
  /** No 2º adiamento, o admin vê na aba Cobranças. */
  avisarAdmin: boolean;
} {
  const adiamentos = Math.min(30, t.adiamentos + 1);
  return {
    prioridade: Math.max(1, (t.prioridade ?? 3) - 1),
    adiamentos,
    avisarAdmin: adiamentos === 2,
  };
}

// ---------------------------------------------------------------- caixinhas sem tarefa de venda

/** Caixinha em que a noite nunca cria tarefa de venda nem toque. */
export function bloqueadaParaVenda(caixinha: Caixinha | number | null): boolean {
  return caixinha === 1 || caixinha === 6 || caixinha === 7 || caixinha === 8 || caixinha === 9;
}

// ---------------------------------------------------------------- textos das tarefas diretas

export function textoPosVenda(o: {
  nome: string;
  servico: string | null;
  osNumero: string | null;
}) {
  const n = o.nome ? `, ${o.nome}` : "";
  return {
    motivo: `Serviço concluído ontem${o.osNumero ? ` (OS ${o.osNumero})` : ""}: pós-venda do dia seguinte.`,
    mensagem: `Oi${n}! Tudo bem? Passando pra saber como ficou ${o.servico ? `a ${o.servico.toLowerCase()}` : "o serviço"} 💙 Ficou do jeito que você esperava?\n\nSe puder, uma avaliação no Google ajuda muito a gente. E se conhecer alguém que precise, é só indicar: quem indica ganha desconto no próximo serviço.`,
  };
}

export function textoRemarcar(o: { nome: string; osNumero: string | null }) {
  const n = o.nome ? `, ${o.nome}` : "";
  return {
    motivo: `Agendamento cancelado${o.osNumero ? ` (OS ${o.osNumero})` : ""} sem nova data: remarcar.`,
    mensagem: `Oi${n}! Vi que a visita foi desmarcada. Quer que eu veja um novo horário pra você nesta semana? Tenho opções de manhã e à tarde.`,
  };
}

export function textoLeadSite(o: { nome: string; servico: string | null; lp: string | null }) {
  return {
    motivo: `Cadastro no site${o.lp ? ` (${o.lp})` : ""} sem conversa no WhatsApp: chamar uma vez (ligação ou modelo aprovado).`,
    mensagem: `Oi${o.nome ? `, ${o.nome}` : ""}! Vi seu cadastro no nosso site${o.servico ? ` sobre ${o.servico.toLowerCase()}` : ""}. Posso te passar um orçamento? Se preferir, me diz um horário bom pra eu te ligar.`,
  };
}

export function textoFollowUpEsquecido(vencidoEm: string) {
  const { dia, hm } = partesSP(vencidoEm);
  return `Follow-up marcado para ${dia.split("-").reverse().slice(0, 2).join("/")} ${hm} não foi feito por ninguém.`;
}
