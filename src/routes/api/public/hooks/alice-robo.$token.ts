import { createFileRoute } from "@tanstack/react-router";

/**
 * Endereço de retorno do robô "Alice" no Chatwoot (outgoing_url do agent bot).
 * O Nexa OS já recebe tudo pelo webhook da conta; aqui só confirmamos o recebimento.
 */
export const Route = createFileRoute("/api/public/hooks/alice-robo/$token")({
  server: {
    handlers: {
      POST: async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
    },
  },
});
