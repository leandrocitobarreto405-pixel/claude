import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Disparo do marketing (Cloud Scheduler a cada minuto): envia o que já pode sair (flags ligadas,
 * campanha aprovada, horário permitido), faz as tarefas no Chatwoot (etiqueta de opt-out,
 * prioridade) e manda os avisos no WhatsApp do dono (se ligado). Com as flags desligadas não sai
 * nada. Autenticação: Authorization: Bearer $NEXA_TAREFAS_SEGREDO.
 * ?agora=<ISO> só nos testes (MKT_TESTE=1).
 */
export const Route = createFileRoute("/api/public/hooks/mkt-disparo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tarefaAutorizada } = await import("@/lib/robo.server");
        if (!tarefaAutorizada(request)) return json({ error: "Não autorizado." }, 401);
        const { log } = await import("@/lib/mkt/contexto.server");
        const resultado: Record<string, unknown> = {};
        let ok = true;
        const passo = async (nome: string, f: () => Promise<unknown>) => {
          try {
            resultado[nome] = await f();
          } catch (erro) {
            ok = false;
            resultado[nome] = { erro: erro instanceof Error ? erro.message : String(erro) };
            log("ERROR", `${nome}.falha`, { erro: String(erro) });
          }
        };
        const { processarFila } = await import("@/lib/mkt/disparo.server");
        const { processarAvisosWhatsapp, processarTarefas } =
          await import("@/lib/mkt/rotinas.server");
        const agora =
          process.env["MKT_TESTE"] === "1" ? new URL(request.url).searchParams.get("agora") : null;
        await passo("disparo", () => processarFila({ agora }));
        await passo("tarefas", () => processarTarefas());
        const { gerarAvisosDeEspera } = await import("@/lib/mkt/avisos-equipe.server");
        await passo("espera", () => gerarAvisosDeEspera());
        await passo("avisos", () => processarAvisosWhatsapp());
        return json({ ok, ...resultado }, ok ? 200 : 500);
      },
    },
  },
});
