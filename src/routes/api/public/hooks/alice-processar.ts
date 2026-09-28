import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Processa uma tarefa da Alice (chamado pelo Cloud Tasks na hora agendada).
 * Autenticação: Authorization: Bearer $NEXA_TAREFAS_SEGREDO.
 */
export const Route = createFileRoute("/api/public/hooks/alice-processar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tarefaAutorizada } = await import("@/lib/robo.server");
        if (!tarefaAutorizada(request)) return json({ error: "Não autorizado." }, 401);
        let tarefaId = "";
        try {
          tarefaId = String(((await request.json()) as { tarefa_id?: unknown }).tarefa_id ?? "");
        } catch {
          return json({ error: "Payload inválido." }, 400);
        }
        if (!/^[0-9a-f-]{36}$/i.test(tarefaId)) return json({ error: "Tarefa inválida." }, 400);
        try {
          const { processarTarefa } = await import("@/lib/alice/motor.server");
          return json({ ok: true, ...(await processarTarefa(tarefaId)) });
        } catch (erro) {
          console.error("Alice: falha ao processar a tarefa", tarefaId, erro);
          return json({ ok: false, error: "Falha temporária." }, 500);
        }
      },
    },
  },
});
