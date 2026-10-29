import { createFileRoute } from "@tanstack/react-router";

const VIAS = new Set(["nativo", "wav", "direto", "nenhum"]);
const RESULTADOS = new Set(["ok", "erro", "tempo"]);

/**
 * Tempo de cada etapa do player de áudio no aparelho (baixar, preparar, começar a tocar), para o
 * registro do servidor. Exige o login; só números e rótulos fixos, sem dado de cliente.
 */
export const Route = createFileRoute("/api/anexo-tempo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { clienteDoPedido } = await import("@/integrations/supabase/auth-middleware");
        try {
          await clienteDoPedido(request.headers);
        } catch {
          return new Response(null, { status: 401 });
        }
        const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const num = (v: unknown) => Math.max(0, Math.min(600_000, Math.round(Number(v) || 0)));
        const ua = request.headers.get("user-agent") ?? "";
        const aparelho = /iPhone|iPad/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "outro";
        const registro = {
          baixarMs: num(b?.["baixarMs"]),
          prepararMs: num(b?.["prepararMs"]),
          iniciarMs: num(b?.["iniciarMs"]),
          via: VIAS.has(String(b?.["via"])) ? String(b?.["via"]) : "nenhum",
          resultado: RESULTADOS.has(String(b?.["resultado"])) ? String(b?.["resultado"]) : "erro",
          aparelho,
        };
        console.log(`Player de áudio: tempos ${JSON.stringify(registro)}`);
        return new Response(null, { status: 204 });
      },
    },
  },
});
