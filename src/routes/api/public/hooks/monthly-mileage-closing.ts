import { createFileRoute } from "@tanstack/react-router";
import { closeMonthlyMileage } from "@/lib/route-auto.server";

/** Mês anterior no fuso de São Paulo (o job roda no dia 1º). */
function previousMonthSaoPaulo() {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
  const [y, m] = hoje.split("-").map(Number);
  const ano = (m ?? 1) === 1 ? (y ?? 2026) - 1 : (y ?? 2026);
  const mes = (m ?? 1) === 1 ? 12 : (m ?? 1) - 1;
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

export const Route = createFileRoute("/api/public/hooks/monthly-mileage-closing")({
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

        let month = previousMonthSaoPaulo();
        try {
          const body = (await request.json().catch(() => null)) as { month?: string } | null;
          if (body?.month && /^\d{4}-\d{2}$/.test(body.month)) month = body.month;
        } catch {
          // corpo vazio é aceito: usa o mês anterior em São Paulo
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const result = await closeMonthlyMileage(supabaseAdmin, { month });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Falha no fechamento mensal da quilometragem:", message);
          return new Response(
            JSON.stringify({ ok: false, error: "Não foi possível calcular a rota automaticamente." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
