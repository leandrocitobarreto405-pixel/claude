import { createFileRoute } from "@tanstack/react-router";

/**
 * Recibo das notificações no celular: o sw.js chama ao receber cada notificação, com o recibo da
 * inscrição (um uuid sem outro dado). Marca que o aparelho recebeu de verdade. Mesma origem do
 * app; responde sempre 204 (nada a vazar).
 */
export const Route = createFileRoute("/api/public/push/recibo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const corpo = (await request.json().catch(() => ({}))) as { recibo?: unknown };
          const recibo = String(corpo.recibo ?? "");
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recibo)) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin.rpc("push_confirmar_recibo" as never, { _recibo: recibo } as never);
          }
        } catch (erro) {
          console.error("[push] recibo.falha", erro instanceof Error ? erro.message : erro);
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
