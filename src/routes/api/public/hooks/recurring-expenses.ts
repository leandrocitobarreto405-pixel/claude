import { createFileRoute } from "@tanstack/react-router";
import { syncRecurringMonth } from "@/lib/recurring-core";

function currentMonthSaoPaulo() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
}

export const Route = createFileRoute("/api/public/hooks/recurring-expenses")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("apikey");
        const allowed = [
          process.env["SUPABASE_ANON_KEY"],
          process.env["SUPABASE_PUBLISHABLE_KEY"],
        ].filter(Boolean);
        if (!key || !allowed.includes(key)) {
          return new Response(JSON.stringify({ error: "Não autorizado." }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const month = currentMonthSaoPaulo();
          const result = await syncRecurringMonth(supabaseAdmin, month);
          return Response.json({ ok: true, month, ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Falha na geração automática de despesas recorrentes:", message);
          return new Response(
            JSON.stringify({ ok: false, error: "Não foi possível sincronizar as despesas recorrentes." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
