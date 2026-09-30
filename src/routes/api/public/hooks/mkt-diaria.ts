import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Rotina diária do marketing (Cloud Scheduler às 9h): dia 1 recalcula os grupos, prepara as
 * campanhas 10 dias antes e pede aprovação, expira o que não foi aprovado até a véspera, gera os
 * gatilhos do dia e, às segundas, o resumo da semana. Não envia nada para cliente.
 * Autenticação: Authorization: Bearer $NEXA_TAREFAS_SEGREDO. ?empresa=<id> só uma empresa.
 * ?hoje=AAAA-MM-DD só nos testes (MKT_TESTE=1).
 */
export const Route = createFileRoute("/api/public/hooks/mkt-diaria")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tarefaAutorizada } = await import("@/lib/robo.server");
        if (!tarefaAutorizada(request)) return json({ error: "Não autorizado." }, 401);
        const url = new URL(request.url);
        const empresa = url.searchParams.get("empresa");
        if (empresa && !/^[0-9a-f-]{36}$/i.test(empresa)) {
          return json({ error: "Empresa inválida." }, 400);
        }
        const hoje = process.env["MKT_TESTE"] === "1" ? url.searchParams.get("hoje") : null;
        if (hoje && !/^\d{4}-\d{2}-\d{2}$/.test(hoje))
          return json({ error: "Data inválida." }, 400);
        try {
          const { rotinaDiaria } = await import("@/lib/mkt/rotinas.server");
          const resultados = await rotinaDiaria({
            empresaId: empresa,
            ...(hoje ? { hoje } : {}),
          });
          return json({ ok: !resultados.some((r) => r.erros.length), resultados });
        } catch (erro) {
          console.error("[mkt] rotina.falha", erro);
          return json({ ok: false, error: "Falha temporária." }, 500);
        }
      },
    },
  },
});
