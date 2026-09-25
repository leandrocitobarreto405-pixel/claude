import { createFileRoute } from "@tanstack/react-router";
import { syncRecurringMonth } from "@/lib/recurring-core";

function currentMonthSaoPaulo() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Gera as despesas recorrentes do mês em cada empresa ativa (chamado pelo agendador). */
export const Route = createFileRoute("/api/public/hooks/recurring-expenses")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { paraCadaEmpresa, tarefaAutorizada } = await import("@/lib/robo.server");
        if (!tarefaAutorizada(request)) return json({ error: "Não autorizado." }, 401);
        try {
          const month = currentMonthSaoPaulo();
          const empresas = await paraCadaEmpresa((db) => syncRecurringMonth(db, month));
          return json({ ok: empresas.every((e) => e.ok), month, empresas });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Falha na geração automática de despesas recorrentes:", message);
          return json(
            { ok: false, error: "Não foi possível sincronizar as despesas recorrentes." },
            500,
          );
        }
      },
    },
  },
});
