import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Exportação diária das vendas para a planilha da importação offline do Google Ads
 * (Cloud Scheduler, uma vez por dia; a varredura da Alice também roda uma vez por dia a partir das
 * 5h, se ninguém rodou). Autenticação: Authorization: Bearer $NEXA_TAREFAS_SEGREDO (não OIDC).
 * ?simular=1 devolve as linhas sem gravar a planilha nem marcar nada; ?empresa=<id> só uma empresa.
 */
export const Route = createFileRoute("/api/public/hooks/ads-exportar-google")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tarefaAutorizada } = await import("@/lib/robo.server");
        if (!tarefaAutorizada(request)) {
          // Fica no banco para dar para ver se o Cloud Scheduler está chamando com a autenticação
          // errada (OIDC no lugar do Bearer com o segredo).
          const { registrarExportacaoRecusada } = await import("@/lib/ads/exportar-google.server");
          await registrarExportacaoRecusada(request).catch(() => undefined);
          return json({ error: "Não autorizado." }, 401);
        }
        const url = new URL(request.url);
        const empresa = url.searchParams.get("empresa");
        if (empresa && !/^[0-9a-f-]{36}$/i.test(empresa)) {
          return json({ error: "Empresa inválida." }, 400);
        }
        try {
          const { exportarConversoesGoogle } = await import("@/lib/ads/exportar-google.server");
          const resultados = await exportarConversoesGoogle({
            simular: url.searchParams.get("simular") === "1",
            empresaId: empresa,
          });
          return json({ ok: !resultados.some((r) => r.situacao === "erro"), resultados });
        } catch (erro) {
          console.error("[ads] exportacao.falha", erro);
          return json({ ok: false, error: "Falha temporária." }, 500);
        }
      },
    },
  },
});
