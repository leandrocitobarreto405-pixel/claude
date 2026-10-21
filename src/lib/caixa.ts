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

// ---------------------------------------------------------------- anexos (foto, documento, áudio)

export type TipoAnexo = "imagem" | "documento" | "audio";

const IMAGENS = ["image/jpeg", "image/png", "image/webp"];
const DOCUMENTOS = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];
export const LIMITES_ANEXO: Record<TipoAnexo, number> = {
  imagem: 5 * 1024 * 1024,
  documento: 16 * 1024 * 1024,
  audio: 10 * 1024 * 1024,
};

/** Confere tipo e tamanho do anexo; devolve o tipo da mensagem no histórico. */
export function validarAnexo(
  tipo: TipoAnexo,
  mime: string | null | undefined,
  tamanho: number,
): { ok: true; tipoMensagem: "Imagem" | "Documento" | "Áudio" } | { ok: false; motivo: string } {
  const m = (mime ?? "").toLowerCase().split(";")[0]!.trim();
  if (!tamanho) return { ok: false, motivo: "Arquivo vazio." };
  if (tamanho > LIMITES_ANEXO[tipo])
    return {
      ok: false,
      motivo: `Arquivo grande demais (até ${LIMITES_ANEXO[tipo] / 1024 / 1024} MB).`,
    };
  if (tipo === "imagem")
    return IMAGENS.includes(m)
      ? { ok: true, tipoMensagem: "Imagem" }
      : { ok: false, motivo: "Foto só em JPG, PNG ou WebP." };
  if (tipo === "documento")
    return DOCUMENTOS.includes(m)
      ? { ok: true, tipoMensagem: "Documento" }
      : { ok: false, motivo: "Documento só em PDF, Word, Excel ou texto." };
  return m.startsWith("audio/") || m === "video/webm" || m === "video/mp4"
    ? { ok: true, tipoMensagem: "Áudio" }
    : { ok: false, motivo: "Áudio inválido." };
}

const EXT_IMAGEM = ["jpg", "jpeg", "png", "webp", "heic", "heif"];

function extensao(nome: string): string {
  return (nome.split(".").pop() ?? "").toLowerCase();
}

export function ehHeic(nome: string, mime: string | null | undefined): boolean {
  const m = (mime ?? "").toLowerCase();
  return m === "image/heic" || m === "image/heif" || ["heic", "heif"].includes(extensao(nome));
}

/**
 * Qualquer imagem escolhida (pelo botão de foto ou pelo de documento) vai como foto, com
 * miniatura no WhatsApp; só os outros tipos vão como documento.
 */
export function classificarAnexo(
  nome: string,
  mime: string | null | undefined,
): "imagem" | "documento" {
  const m = (mime ?? "").toLowerCase().split(";")[0]!.trim();
  if (m.startsWith("image/")) return "imagem";
  return EXT_IMAGEM.includes(extensao(nome)) ? "imagem" : "documento";
}

/** Nome do arquivo sem caminho nem caracteres estranhos (vai para o Chatwoot e para o histórico). */
export function nomeSeguro(nome: string, padrao: string): string {
  const base = nome.split(/[\\/]/).pop() ?? "";
  const limpo = base
    .replace(/[^\w.() -]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return limpo || padrao;
}
