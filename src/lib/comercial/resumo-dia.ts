/**
 * Resumo do dia da Tatiana (12/11, custo aprovado pelo dono): a noite guarda na ficha um resumo
 * curto do lead e até que mensagem ele cobre. Nas noites seguintes ela manda para a IA o resumo e
 * só o fim da conversa (o que chegou depois dele, com um mínimo de contexto), em vez da conversa
 * inteira. Uma vez por semana relê tudo. A decisão continua sendo tomada em toda leitura: nenhuma
 * tarefa deixa de ser criada por causa do resumo. Regras puras, sem banco.
 */
import type { MensagemLead } from "./fatos";

/** De quantos em quantos dias a conversa inteira é relida. */
export const RELEITURA_DIAS = 7;
/** Mínimo de mensagens do fim da conversa que sempre vão junto com o resumo. */
export const CONTEXTO_MINIMO = 12;
/** Tamanho máximo do resumo guardado. */
export const RESUMO_MAX = 1_500;

export type FichaDoResumo = {
  resumo_dia: string | null;
  resumo_ate: string | null;
  leitura_completa_em: string | null;
} | null;

const ms = (iso: string) => Date.parse(iso);

/**
 * "completa" na primeira leitura, quando falta o resumo ou a data, ou quando a última leitura
 * completa tem 7 dias ou mais; senão "incremental".
 */
export function modoDeLeitura(ficha: FichaDoResumo, agora: Date): "completa" | "incremental" {
  if (!ficha?.resumo_dia?.trim() || !ficha.resumo_ate || !ficha.leitura_completa_em)
    return "completa";
  const t = ms(ficha.leitura_completa_em);
  if (Number.isNaN(t) || Number.isNaN(ms(ficha.resumo_ate))) return "completa";
  return agora.getTime() - t >= RELEITURA_DIAS * 86_400_000 ? "completa" : "incremental";
}

/**
 * O fim da conversa que vai com o resumo: tudo o que chegou depois dele e, no mínimo, as últimas
 * 12 mensagens (para a mensagem pronta citar o que o cliente disse). Em ordem de data.
 */
export function mensagensParaLer(mensagens: MensagemLead[], resumoAte: string): MensagemLead[] {
  const ordenadas = [...mensagens].sort((a, b) => ms(a.em) - ms(b.em));
  const corte = ms(resumoAte);
  const novas = ordenadas.filter((m) => ms(m.em) > corte).length;
  return ordenadas.slice(-Math.max(novas, CONTEXTO_MINIMO));
}

/** Data e hora da mensagem mais recente (até onde o resumo novo cobre); null sem mensagens. */
export function ultimaMensagemEm(mensagens: MensagemLead[]): string | null {
  let ultima: string | null = null;
  for (const m of mensagens) if (!ultima || ms(m.em) > ms(ultima)) ultima = m.em;
  return ultima;
}

/** Resumo pronto para gravar ("" quando a IA não devolveu nada aproveitável). */
export function limparResumo(texto: string | null | undefined): string {
  return (texto ?? "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, RESUMO_MAX);
}

/** Bloco "CONVERSA" do pedido de decisão, com ou sem o resumo na frente. */
export function blocoDaConversa(o: {
  modo: "completa" | "incremental";
  resumo: string | null;
  resumoAte: string | null;
  conversa: string;
}): string[] {
  if (o.modo === "completa" || !o.resumo) return ["CONVERSA:", o.conversa || "(sem mensagens)"];
  return [
    `RESUMO DO QUE JÁ FOI LIDO (até ${(o.resumoAte ?? "").slice(0, 10)}):`,
    o.resumo,
    "",
    "CONVERSA (só o fim; o resumo acima cobre o que veio antes):",
    o.conversa || "(sem mensagens novas)",
  ];
}

/** Linha das instruções da decisão que pede o resumo (vai no fim do roteiro da Tatiana). */
export const INSTRUCAO_RESUMO =
  "6. resumo: até 8 linhas curtas com o que importa deste lead para as próximas noites, juntando o RESUMO DO QUE JÁ FOI LIDO (se veio) com o que mudou agora: o que o cliente quer e os itens; valores passados (R$) e por quem; datas e horários combinados; objeções e concorrente citado; o que o cliente prometeu (e para quando); o que a equipe ou a Alice ficou de fazer; o que falta no app. Só fatos da conversa e do app, sem opinião. Nunca deixe vazio.";
