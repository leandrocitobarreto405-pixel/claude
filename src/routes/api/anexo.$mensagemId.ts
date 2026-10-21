import { createFileRoute } from "@tanstack/react-router";

/**
 * Arquivo de uma mensagem (áudio, foto, documento), baixado pelo servidor com o token da
 * conexão do Chatwoot. Exige o token da pessoa (Authorization) e a empresa ativa (x-empresa-id),
 * como as funções do servidor; a mensagem é lida pelo RLS.
 */
export const Route = createFileRoute("/api/anexo/$mensagemId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { servirAnexo } = await import("@/lib/anexos.server");
        try {
          return await servirAnexo(request, params.mensagemId ?? "");
        } catch (erro) {
          console.error("Anexo: erro inesperado", erro instanceof Error ? erro.message : erro);
          return new Response(JSON.stringify({ error: "Falha temporária." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
