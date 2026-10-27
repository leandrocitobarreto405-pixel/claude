/**
 * Alarme de crédito da IA (27/10/2026): reconhece, no erro da IA ou da voz, falta de crédito/saldo ou
 * chave recusada (o resto, como lentidão ou limite por minuto, não é parada) e monta os textos dos
 * avisos. Quem grava o período e decide quando avisar é o banco (ia_registrar_parada).
 */
export type ProvedorParada = "ia" | "voz";
export type CausaParada = "credito" | "autenticacao";

/** De 2 em 2 horas, enquanto a parada durar (o banco usa o mesmo intervalo). */
export const REPETIR_AVISO_MS = 2 * 3600_000;

const CREDITO =
  /credit balance|insufficient (credit|funds|balance)|billing|quota_exceeded|quota exceeded|payment required|out of credits|not enough credits/i;
const AUTENTICACAO =
  /authentication_error|invalid[_ ]x?-?api[_ -]?key|invalid api key|api key.*(invalid|revoked|disabled)/i;

/**
 * Erro da chamada à IA (SDK da Anthropic) que para a Alice; null = não é falta de crédito nem chave.
 * Só para o erro da própria chamada à IA (um 401 do Chatwoot não é parada da IA).
 */
export function causaDaParadaIa(e: unknown): CausaParada | null {
  const o = (e ?? {}) as { status?: unknown; type?: unknown; message?: unknown };
  const status = typeof o.status === "number" ? o.status : null;
  const tipo = typeof o.type === "string" ? o.type : "";
  const texto = `${tipo} ${typeof o.message === "string" ? o.message : String(e ?? "")}`;
  if (tipo === "billing_error" || status === 402 || CREDITO.test(texto)) return "credito";
  if (tipo === "authentication_error" || status === 401 || AUTENTICACAO.test(texto))
    return "autenticacao";
  return null;
}

/** Erro curto da voz ("ElevenLabs respondeu 401 (401): quota_exceeded ..."). */
export function causaDaParadaVoz(erro: string): CausaParada | null {
  if (!erro) return null;
  if (CREDITO.test(erro) || /\(402\)/.test(erro)) return "credito";
  if (AUTENTICACAO.test(erro) || /\(401\)/.test(erro)) return "autenticacao";
  return null;
}

/** "14:05" no horário de São Paulo (com a data, se não for hoje). */
export function horaDaParada(desde: Date, agora = new Date()): string {
  const fuso = "America/Sao_Paulo";
  const dia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: fuso });
  const hora = desde.toLocaleTimeString("pt-BR", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
  });
  return dia(desde) === dia(agora)
    ? hora
    : `${desde.toLocaleDateString("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit" })} ${hora}`;
}

/** Título do aviso à Nexa (push e Painel Nexa). */
export function tituloParadaNexa(
  provedor: ProvedorParada,
  causa: CausaParada,
  desde: Date,
  agora = new Date(),
): string {
  const h = horaDaParada(desde, agora);
  if (provedor === "ia")
    return causa === "credito"
      ? `Alice parada: sem crédito na conta da IA desde ${h}`
      : `Alice parada: chave da IA recusada desde ${h}`;
  return causa === "credito"
    ? `Áudio da Alice parado: sem crédito na conta de voz desde ${h}`
    : `Áudio da Alice parado: chave de voz recusada desde ${h}`;
}

/** Corpo do aviso à Nexa: o que acontece e o que fazer. */
export function corpoParadaNexa(
  provedor: ProvedorParada,
  empresas: number,
  conversas: number,
): string {
  if (provedor === "voz")
    return "A Alice segue respondendo em texto. Confira o saldo e a chave da conta de voz.";
  const emp = empresas === 1 ? "1 empresa" : `${empresas} empresas`;
  const conv = conversas === 1 ? "1 conversa foi" : `${conversas} conversas foram`;
  return `${conv} para a equipe (${emp}). Confira o saldo e a chave da conta da IA.`;
}

/** Nota na conversa quando a resposta não sai por falta de crédito ou chave. */
export function notaParadaConversa(causa: CausaParada): string {
  return causa === "credito"
    ? "A Alice está pausada (sem crédito na conta da IA): a conversa ficou com a equipe."
    : "A Alice está pausada (chave da IA recusada): a conversa ficou com a equipe.";
}

/** Duração de um período ("2 h 15 min", "40 min"). */
export function duracaoDaParada(inicio: Date, fim: Date): string {
  const min = Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}
