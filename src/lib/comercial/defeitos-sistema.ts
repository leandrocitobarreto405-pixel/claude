/**
 * Defeitos da Alice contados pelo sistema (exatos, sem IA): orçamento sem CEP, foto do técnico
 * antes de agendar, dois toques no mesmo dia e toque com retorno combinado ainda por vir. Regras
 * puras; quem busca no banco é comercial.functions. Antes × depois pela data da correção de cada um.
 */
import { NOME_DEFEITO, type DefeitoAlice } from "./ficha";
import { CORTE_DEFEITO } from "./relatorio";

export const DEFEITOS_SISTEMA = [
  "orcou_sem_cep",
  "foto_tecnico_antes_agendar",
  "dois_toques_mesmo_dia",
  "toque_apos_retorno_combinado",
] as const satisfies readonly DefeitoAlice[];
export type DefeitoSistema = (typeof DEFEITOS_SISTEMA)[number];

export type EventoDefeito = { defeito: DefeitoSistema; em: string; lead: string | null };

/** Dia em São Paulo (AAAA-MM-DD) de um instante. */
const diaSP = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

/** Orçamento criado pela Alice sem CEP nem endereço. */
export function orcamentosSemCep(
  qs: Array<{
    criadoEm: string;
    lead: string | null;
    cep: string | null;
    endereco: string | null;
    daAlice: boolean;
  }>,
): EventoDefeito[] {
  return qs
    .filter((q) => q.daAlice && !(q.cep ?? "").replace(/\D/g, "") && !(q.endereco ?? "").trim())
    .map((q) => ({ defeito: "orcou_sem_cep", em: q.criadoEm, lead: q.lead }));
}

/** Foto do técnico mandada (enviar_dados_tecnico) antes de o lead ter OS ou agendamento. */
export function fotosAntesDeAgendar(
  envios: Array<{ em: string; lead: string | null }>,
  agendadoEm: Map<string, string | null>,
): EventoDefeito[] {
  return envios
    .filter((e) => {
      if (!e.lead) return false;
      const ag = agendadoEm.get(e.lead) ?? null;
      return !ag || Date.parse(ag) > Date.parse(e.em);
    })
    .map((e) => ({ defeito: "foto_tecnico_antes_agendar", em: e.em, lead: e.lead }));
}

/** Dois ou mais toques da Alice (trilhas A e B) no mesmo dia para o mesmo lead, sem resposta. */
export function doisToquesNoDia(
  toques: Array<{ em: string; lead: string; respondido: boolean }>,
): EventoDefeito[] {
  const porDia = new Map<string, Array<{ em: string; respondido: boolean }>>();
  for (const t of toques) {
    const k = `${t.lead}|${diaSP(t.em)}`;
    porDia.set(k, [...(porDia.get(k) ?? []), t]);
  }
  const saida: EventoDefeito[] = [];
  for (const [k, ts] of porDia) {
    const semResposta = ts.filter((t) => !t.respondido).sort((a, b) => a.em.localeCompare(b.em));
    if (semResposta.length >= 2)
      saida.push({
        defeito: "dois_toques_mesmo_dia",
        em: semResposta[1]!.em,
        lead: k.split("|")[0]!,
      });
  }
  return saida;
}

/** Toque da Alice mandado quando o retorno combinado com o cliente ainda estava por vir. */
export function toquesComRetornoCombinado(
  toques: Array<{ em: string; lead: string; trilha: string | null }>,
  retornoEm: Map<string, string | null>,
): EventoDefeito[] {
  return toques
    .filter((t) => t.trilha !== "C")
    .filter((t) => {
      const r = retornoEm.get(t.lead) ?? null;
      return r !== null && Date.parse(r) > Date.parse(t.em);
    })
    .map((t) => ({ defeito: "toque_apos_retorno_combinado", em: t.em, lead: t.lead }));
}

export type DefeitoSistemaContado = {
  id: DefeitoSistema;
  nome: string;
  /** Data da correção (null = ainda não publicada). */
  corte: string | null;
  antes: number;
  depois: number;
  /** Casos por dia antes e depois da correção (para comparar períodos de tamanhos diferentes). */
  porDiaAntes: number | null;
  porDiaDepois: number | null;
};

/** Antes × depois de cada defeito, desde `inicio` até `agora`. */
export function contarDefeitosSistema(
  eventos: EventoDefeito[],
  inicio: string,
  agora: Date,
  corteDe: (d: DefeitoSistema) => string | null = (d) => CORTE_DEFEITO[d],
): DefeitoSistemaContado[] {
  const ini = Date.parse(inicio);
  const fim = agora.getTime();
  return DEFEITOS_SISTEMA.map((id) => {
    const corte = corteDe(id);
    const c = corte ? Math.min(Math.max(Date.parse(corte), ini), fim) : fim;
    const doTipo = eventos.filter((e) => e.defeito === id && Date.parse(e.em) >= ini);
    const antes = doTipo.filter((e) => Date.parse(e.em) < c).length;
    const depois = doTipo.length - antes;
    const dias = (ms: number) => ms / 86_400_000;
    return {
      id,
      nome: NOME_DEFEITO[id],
      corte,
      antes,
      depois,
      porDiaAntes: c - ini >= 86_400_000 ? antes / dias(c - ini) : null,
      porDiaDepois: corte && fim - c >= 86_400_000 ? depois / dias(fim - c) : null,
    };
  });
}
