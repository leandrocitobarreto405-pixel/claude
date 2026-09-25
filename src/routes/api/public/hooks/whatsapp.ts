import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook direto da Meta (WhatsApp Cloud API) — desativado.
 *
 * Decisão D2 (docs/nexa-os/DECISOES.md): o WhatsApp das empresas entra pelo Chatwoot, e este
 * endpoint não identificava a empresa de destino. O processamento (crm-webhook.server.ts)
 * continua sendo usado pelo simulador e servirá de base para a integração com o Chatwoot.
 */
function desativado() {
  return new Response(
    JSON.stringify({
      error: "Endpoint desativado. O WhatsApp é recebido pela integração com o Chatwoot.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  );
}

export const Route = createFileRoute("/api/public/hooks/whatsapp")({
  server: {
    handlers: {
      GET: async () => desativado(),
      POST: async () => desativado(),
    },
  },
});
