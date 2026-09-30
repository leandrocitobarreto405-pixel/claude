import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Rede de segurança da fila da Alice (Cloud Scheduler a cada 5–10 min): entrega à fila o que ficou
 * de fora e processa tarefas atrasadas (fila perdida, servidor reiniciado).
 * Autenticação: Authorization: Bearer $NEXA_TAREFAS_SEGREDO.
 */
export const Route = createFileRoute("/api/public/hooks/alice-varredura")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tarefaAutorizada } = await import("@/lib/robo.server");
        if (!tarefaAutorizada(request)) return json({ error: "Não autorizado." }, 401);
        try {
          const { varrerFila } = await import("@/lib/alice/fila.server");
          const { iniciarContatosPendentes } = await import("@/lib/ads/alice-contato.server");
          const fila = await varrerFila();
          // Fase 2 dos anúncios (desligada por padrão): Alice inicia a conversa do pop-up.
          const anuncios = await iniciarContatosPendentes().catch((e) => {
            console.error("[ads] alice_contato.falha", e);
            return null;
          });
          return json({ ok: true, ...fila, anuncios });
        } catch (erro) {
          console.error("Alice: falha na varredura", erro);
          return json({ ok: false, error: "Falha temporária." }, 500);
        }
      },
    },
  },
});
