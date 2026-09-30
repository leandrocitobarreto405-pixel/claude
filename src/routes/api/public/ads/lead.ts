import { createFileRoute } from "@tanstack/react-router";

/**
 * Captação do pop-up das landing pages (Google Ads). POST com JSON, formulário ou sendBeacon.
 * CORS só para os domínios em ads_dominios. Responde sempre 200 (o front nunca trava): o
 * resultado vem em { ok, resultado } e o motivo de qualquer recusa vai para o log.
 */
export const Route = createFileRoute("/api/public/ads/lead")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { cabecalhosCors, dominioPermitido, hostDe, log } =
          await import("@/lib/ads/captacao.server");
        const origem = request.headers.get("origin");
        const permitido = await dominioPermitido(hostDe(request));
        if (!permitido) log("WARNING", "cors.recusado", { origem });
        return new Response(null, {
          status: 204,
          headers: cabecalhosCors(permitido ? origem : null),
        });
      },
      POST: async ({ request }) => {
        const { cabecalhosCors, dominioPermitido, hostDe, log, registrarClique } =
          await import("@/lib/ads/captacao.server");
        const origem = request.headers.get("origin");
        let corpo: object = { ok: false, resultado: "erro" };
        let permitido = false;
        try {
          permitido = origem ? await dominioPermitido(hostDe(request)) : false;
          corpo = await registrarClique(request);
        } catch (erro) {
          log("ERROR", "captacao.erro_inesperado", {
            erro: erro instanceof Error ? erro.message : String(erro),
          });
        }
        return new Response(JSON.stringify(corpo), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...cabecalhosCors(permitido ? origem : null),
          },
        });
      },
    },
  },
});
