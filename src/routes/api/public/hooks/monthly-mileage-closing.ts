import { createFileRoute } from "@tanstack/react-router";
import { closeMonthlyMileage } from "@/lib/route-auto.server";

/** Mês anterior no fuso de São Paulo (o job roda no dia 1º). */
function previousMonthSaoPaulo() {
  const hoje = new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
    .slice(0, 10);
  const [y, m] = hoje.split("-").map(Number);
  const ano = (m ?? 1) === 1 ? (y ?? 2026) - 1 : (y ?? 2026);
  const mes = (m ?? 1) === 1 ? 12 : (m ?? 1) - 1;
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Fecha a quilometragem do mês em cada empresa ativa (chamado pelo agendador). */
export const Route = createFileRoute("/api/public/hooks/monthly-mileage-closing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { paraCadaEmpresa, tarefaAutorizada } = await import("@/lib/robo.server");
        if (!tarefaAutorizada(request)) return json({ error: "Não autorizado." }, 401);

        let month = previousMonthSaoPaulo();
        const body = (await request.json().catch(() => null)) as { month?: string } | null;
        if (body?.month && /^\d{4}-\d{2}$/.test(body.month)) month = body.month;

        try {
          const empresas = await paraCadaEmpresa((db) => closeMonthlyMileage(db, { month }));
          return json({ ok: empresas.every((e) => e.ok), month, empresas });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Falha no fechamento mensal da quilometragem:", message);
          return json(
            { ok: false, error: "Não foi possível calcular a rota automaticamente." },
            500,
          );
        }
      },
    },
  },
});
