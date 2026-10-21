/**
 * Caixa de entrada no app (responder pelo Nexa OS, sobre o Chatwoot). Regras puras, sem banco:
 * janela de 24 h do WhatsApp, validação do texto, quais modelos aprovados servem para responder e
 * quem pode responder.
 */
import { dentroDaJanela, fimDaJanela } from "@/lib/alice/regras";
import { preencher, type ModeloMeta } from "@/lib/mkt/modelos";
import type { Papel } from "@/lib/tenant";

export const MAX_TEXTO = 4096;

export type Janela =
  | { aberta: true; fechaEm: string }
  | { aberta: false; motivo: "sem_mensagem_do_cliente" | "passou_24h" };

/** A janela de 24 h conta da última mensagem RECEBIDA do cliente (com a mesma folga da Alice). */
export function janelaDeResposta(ultimaDoCliente: string | null, agora = new Date()): Janela {
  if (!ultimaDoCliente) return { aberta: false, motivo: "sem_mensagem_do_cliente" };
  const ultima = new Date(ultimaDoCliente);
  if (!dentroDaJanela(ultima, agora)) return { aberta: false, motivo: "passou_24h" };
  return { aberta: true, fechaEm: fimDaJanela(ultima).toISOString() };
}

export function validarTexto(texto: unknown): string {
  const t = String(texto ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!t) throw new Error("Escreva a mensagem antes de enviar.");
  if (t.length > MAX_TEXTO) throw new Error(`Mensagem muito longa (até ${MAX_TEXTO} caracteres).`);
  return t;
}

/** Admin e atendente respondem; o técnico não abre Conversas. */
export function podeResponder(papel: Papel | null): boolean {
  return papel === "admin" || papel === "atendente";
}

export type SituacaoResposta =
  { pode: true; reabre: boolean } | { pode: false; motivo: "com_a_alice" };

/**
 * Conversa com a Alice (pending): a equipe precisa assumir antes de responder, senão as duas
 * falam ao mesmo tempo. Encerrada (resolved): responder reabre para a equipe.
 */
export function situacaoParaResponder(status: string | null): SituacaoResposta {
  if (status === "pending") return { pode: false, motivo: "com_a_alice" };
  return { pode: true, reabre: status === "resolved" };
}

export type ModeloParaResponder = {
  nome: string;
  idioma: string;
  /** Texto como vai chegar ao cliente (variáveis já preenchidas). */
  texto: string;
  parametros: Record<string, string>;
};

/**
 * Modelos aprovados que dá para mandar fora da janela: só os que se preenchem sozinhos (nome do
 * cliente) — os que pedem condição de campanha ficam de fora.
 */
export function modelosParaResponder(
  modelos: ModeloMeta[],
  primeiroNome: string | null,
): ModeloParaResponder[] {
  const lista: ModeloParaResponder[] = [];
  for (const m of modelos) {
    if (String(m.status).toUpperCase() !== "APPROVED") continue;
    const p = preencher(m, { primeiroNome, condicao: null });
    if (!p.ok) continue;
    lista.push({ nome: m.name, idioma: m.language, texto: p.texto, parametros: p.parametros });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Primeiro nome do contato, sem números nem emojis; null quando não dá para confiar. */
export function primeiroNomeDoContato(nome: string | null | undefined): string | null {
  const p = (nome ?? "")
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}'-]/gu, "");
  return p && p.length >= 2 ? p[0]!.toUpperCase() + p.slice(1) : null;
}
