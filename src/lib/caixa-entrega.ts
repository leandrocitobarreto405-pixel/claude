/**
 * Status de entrega a partir do webhook do Chatwoot (message_created / message_updated). Hoje o
 * Chatwoot só informa a falha (content_attributes.external_error); se a versão dele mandar o
 * campo "status" do WhatsApp (sent, delivered, read, failed), também é lido. Função pura.
 */
export type Entrega = { chatwootMessageId: number; status: string; erro: string | null };

const MAPA: Record<string, string> = {
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falhou",
};

export function statusDeEntrega(p: Record<string, unknown>): Entrega | null {
  const evento = p["event"];
  if (evento !== "message_updated" && evento !== "message_created") return null;
  if (p["message_type"] !== "outgoing") return null;
  const id = Number(p["id"]);
  if (!Number.isFinite(id) || id <= 0) return null;
  const attrs = (p["content_attributes"] ?? {}) as Record<string, unknown>;
  const erro = attrs["external_error"];
  if (typeof erro === "string" && erro.trim())
    return { chatwootMessageId: id, status: "falhou", erro: erro.trim().slice(0, 300) };
  const status = typeof p["status"] === "string" ? MAPA[p["status"]] : undefined;
  if (status) return { chatwootMessageId: id, status, erro: null };
  return null;
}
