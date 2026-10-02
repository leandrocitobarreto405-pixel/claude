// Regras da promoção para agenda vazia e do alerta de rodízio (sem banco, para poder testar).
import { chaveTelefone } from "@/lib/avisos";

export type HorarioBase = { tecnicoId: string; tecnico: string; diaSemana: number; hora: string };
export type Ocupacao = { tecnicoId: string | null; hora: string; status: string };
export type HorarioLivre = { tecnicoId: string; tecnico: string; hora: string };

/** Atendimentos que não ocupam mais o horário. */
const NAO_OCUPAM = ["Cancelado", "Reagendado", "Reagendado com deslocamento"];

/** 0 = domingo ... 6 = sábado, para uma data AAAA-MM-DD. */
export function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}

const hhmm = (h: string) => h.slice(0, 5);

/**
 * Horários base livres de um dia: o horário do técnico está livre quando não há atendimento
 * marcado nele (do próprio técnico ou sem técnico). Encaixes em outros horários não contam.
 */
export function horariosLivres(
  base: HorarioBase[],
  ocupacoes: Ocupacao[],
  data: string,
): HorarioLivre[] {
  const dia = diaDaSemana(data);
  const ativas = ocupacoes.filter((o) => !NAO_OCUPAM.includes(o.status));
  return base
    .filter((b) => b.diaSemana === dia)
    .filter(
      (b) =>
        !ativas.some(
          (o) =>
            hhmm(o.hora) === hhmm(b.hora) && (o.tecnicoId === null || o.tecnicoId === b.tecnicoId),
        ),
    )
    .map((b) => ({ tecnicoId: b.tecnicoId, tecnico: b.tecnico, hora: hhmm(b.hora) }))
    .sort((a, b) => a.hora.localeCompare(b.hora) || a.tecnico.localeCompare(b.tecnico));
}

export type Candidato = {
  telefone: string;
  nome: string;
  origem: "orcamento" | "conversa";
  /** Data do orçamento ou da conversa (ISO), para mostrar. */
  desde: string;
};

export type Destinatario = Candidato & { chave: string };

/**
 * Quem recebe a promoção: orçamentos em aberto e conversas novas, sem repetir pessoa, sem quem
 * já tem agendamento, sem contato interno da equipe e sem quem saiu das ofertas.
 */
export function montarDestinatarios(
  candidatos: Candidato[],
  bloqueados: { comAgendamento: string[]; internos: string[]; optout: string[] },
): Destinatario[] {
  const fora = new Set(
    [...bloqueados.comAgendamento, ...bloqueados.internos, ...bloqueados.optout]
      .map(chaveTelefone)
      .filter((c): c is string => Boolean(c)),
  );
  const vistos = new Set<string>();
  const lista: Destinatario[] = [];
  for (const c of candidatos) {
    const chave = chaveTelefone(c.telefone);
    if (!chave || chave.length < 10 || fora.has(chave) || vistos.has(chave)) continue;
    if (!c.nome.trim()) continue;
    vistos.add(chave);
    lista.push({ ...c, nome: c.nome.trim(), chave });
  }
  return lista;
}

/** "20%" ou "12,5%". */
export function pct(n: number): string {
  return `${String(Number(n)).replace(".", ",")}%`;
}

/** Prévia da mensagem (o texto exato vem do modelo aprovado na Meta). */
export function previaMensagem(
  nome: string,
  desconto: number,
  pix: number,
  empresa: string,
): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  return `Oi, ${primeiro}! Aqui é da ${empresa}. Abriu um horário amanhã e consigo fazer o seu serviço com ${pct(
    desconto,
  )} de desconto, e mais ${pct(pix)} se pagar no Pix. Quer que eu reserve para você?`;
}

// ---------------------------------------------------------------- rodízio
export type ConfigRodizio = {
  comecarAPartir: string; // "11:00"
  tardeInicio: string; // "17:00"
  duracaoMin: number;
  voltaMin: number;
};

export type Veiculo = { nome: string; tecnicoId: string | null; diaRodizio: number | null };

const minutos = (h: string) => {
  const [hh, mm] = h.split(":").map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
};
const horaTexto = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * Alerta (não bloqueia) ao marcar no dia do rodízio do veículo do técnico: começar antes do
 * horário mínimo, ou o fim do atendimento + a volta passar do início do rodízio da tarde.
 */
export function alertaRodizio(
  a: { data: string; hora: string; tecnicoId: string | null },
  veiculos: Veiculo[],
  cfg: ConfigRodizio,
): string | null {
  if (!a.data || !a.hora || !a.tecnicoId) return null;
  const dia = diaDaSemana(a.data);
  const v = veiculos.find((x) => x.tecnicoId === a.tecnicoId && x.diaRodizio === dia);
  if (!v) return null;
  const inicio = minutos(a.hora.slice(0, 5));
  const fimComVolta = inicio + cfg.duracaoMin + cfg.voltaMin;
  const problemas: string[] = [];
  if (inicio < minutos(cfg.comecarAPartir))
    problemas.push(`começa antes das ${cfg.comecarAPartir.slice(0, 5)}`);
  if (fimComVolta > minutos(cfg.tardeInicio))
    problemas.push(
      `com a volta, termina por volta das ${horaTexto(fimComVolta)} (rodízio a partir das ${cfg.tardeInicio.slice(0, 5)})`,
    );
  if (!problemas.length) return null;
  return `Dia de rodízio do ${v.nome} (${NOMES_DIA[dia]}): ${problemas.join(" e ")}.`;
}
