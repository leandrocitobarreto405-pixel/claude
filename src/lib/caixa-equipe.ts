/**
 * Regras puras da equipe na caixa de entrada (sem banco): "Minhas", não lidas e o ritmo do
 * "digitando…".
 */

/** A conversa é minha: assumi pelo app ou está atribuída ao meu usuário do Chatwoot. */
export function ehMinha(
  c: { assumidaPor: string | null; responsavelId: number | null; grupo: string },
  eu: { userId: string; chatwootAgentId: number | null },
): boolean {
  if (c.grupo === "finalizadas") return false;
  if (c.assumidaPor && c.assumidaPor === eu.userId) return true;
  return eu.chatwootAgentId != null && c.responsavelId === eu.chatwootAgentId;
}

/** Mensagens do cliente depois da última leitura desta pessoa (sem leitura: todas). */
export function contarNaoLidas(
  mensagens: Array<{ direction: string; message_timestamp: string }>,
  lidaEm: string | null | undefined,
): number {
  const limite = lidaEm ? new Date(lidaEm).getTime() : 0;
  let n = 0;
  for (const m of mensagens)
    if (m.direction === "Recebida" && new Date(m.message_timestamp).getTime() > limite) n++;
  return n;
}

/** Intervalo mínimo entre dois avisos de "digitando…" para a mesma conversa. */
export const INTERVALO_DIGITANDO_MS = 20_000;

/** Decide se vale mandar outro aviso de "digitando…" agora. */
export function podeAvisarDigitando(ultimoEnvioMs: number | null, agoraMs: number): boolean {
  return ultimoEnvioMs == null || agoraMs - ultimoEnvioMs >= INTERVALO_DIGITANDO_MS;
}
