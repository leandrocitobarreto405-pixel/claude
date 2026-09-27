import { createHmac, timingSafeEqual } from "node:crypto";

/** Tolerância entre o horário da assinatura e o do servidor (evita reenvio de avisos antigos). */
export const JANELA_ASSINATURA_SEGUNDOS = 300;

export type ResultadoAssinatura =
  | { ok: true }
  | {
      ok: false;
      motivo: "sem_assinatura" | "horario_invalido" | "fora_da_janela" | "assinatura_invalida";
    };

/**
 * Confere o cabeçalho X-Chatwoot-Signature.
 *
 * Formato (lib/webhooks/trigger.rb do Chatwoot):
 *   X-Chatwoot-Timestamp: <unix em segundos>
 *   X-Chatwoot-Signature: sha256=HMAC_SHA256(segredo, "<timestamp>.<corpo bruto>")
 */
export function verificarAssinaturaChatwoot(
  corpoBruto: string,
  segredo: string,
  cabecalhos: Headers,
  agoraEmSegundos = Math.floor(Date.now() / 1000),
): ResultadoAssinatura {
  const assinatura = cabecalhos.get("x-chatwoot-signature");
  const timestamp = cabecalhos.get("x-chatwoot-timestamp");
  if (!assinatura || !timestamp) return { ok: false, motivo: "sem_assinatura" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, motivo: "horario_invalido" };
  if (Math.abs(agoraEmSegundos - Number(timestamp)) > JANELA_ASSINATURA_SEGUNDOS) {
    return { ok: false, motivo: "fora_da_janela" };
  }

  const recebida = assinatura.startsWith("sha256=") ? assinatura.slice(7) : assinatura;
  const esperada = createHmac("sha256", segredo)
    .update(`${timestamp}.${corpoBruto}`, "utf8")
    .digest("hex");
  const a = Buffer.from(recebida, "utf8");
  const b = Buffer.from(esperada, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, motivo: "assinatura_invalida" };
  }
  return { ok: true };
}

/** Eventos que a conexão precisa assinar no Chatwoot (Configurações → Integrações → Webhooks). */
export const EVENTOS_CHATWOOT = [
  "conversation_created",
  "conversation_updated",
  "conversation_status_changed",
  "message_created",
  "message_updated",
  "contact_created",
  "contact_updated",
] as const;
