import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Reprocessa eventos do Chatwoot pendentes (chamado pelo agendador a cada poucos minutos). */
export const Route = createFileRoute("/api/public/hooks/chatwoot-reprocessar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tarefaAutorizada } = await import("@/lib/robo.server");
        if (!tarefaAutorizada(request)) return json({ error: "Não autorizado." }, 401);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("reprocessar_eventos_chatwoot", {
          _limite: 200,
        });
        if (error) {
          console.error("Chatwoot: falha no reprocessamento:", error.message);
          return json({ ok: false, error: "Falha no reprocessamento." }, 500);
        }
        // Recupera respostas da Alice que ficaram sem entregar à fila.
        const { enfileirarPendentes } = await import("@/lib/alice/fila.server");
        const alice = await enfileirarPendentes(supabaseAdmin, 200).catch(() => 0);
        // Limpeza dos eventos antigos (desligada até a Nexa ligar; lote pequeno a cada chamada).
        const { data: limpeza, error: erroLimpeza } = await supabaseAdmin.rpc(
          "limpar_eventos_chatwoot",
          { _limite: 2000 },
        );
        if (erroLimpeza)
          console.error("Chatwoot: falha na limpeza dos eventos:", erroLimpeza.message);
        return json({ ok: true, ...(data as object), alice_enfileiradas: alice, limpeza });
      },
    },
  },
});
