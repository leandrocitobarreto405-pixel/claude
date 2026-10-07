import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { ORIGENS_DO_APP } from "./lib/enderecos";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/**
 * CORS das chamadas pesadas que o app (aberto pelo domínio do Firebase) faz direto ao Cloud Run:
 * só para as funções do servidor e só para as origens do app.
 */
function origemCors(request: Request): string | null {
  const origem = request.headers.get("Origin");
  if (!origem || !ORIGENS_DO_APP.includes(origem)) return null;
  if (!new URL(request.url).pathname.startsWith("/_serverFn/")) return null;
  return origem === new URL(request.url).origin ? null : origem;
}

/**
 * Cabeçalhos da resposta que o navegador precisa ler numa chamada de outra origem. Sem eles, o
 * app não sabe que a resposta vem serializada e lê o resultado errado (a ação é feita no
 * servidor, mas a tela quebra).
 */
export const CABECALHOS_EXPOSTOS = "x-tss-serialized, x-tss-raw, content-type";

export function comCors(response: Response, origem: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origem);
  headers.set("Access-Control-Expose-Headers", CABECALHOS_EXPOSTOS);
  headers.append("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const cors = origemCors(request);
    if (cors && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": cors,
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers":
            request.headers.get("Access-Control-Request-Headers") ?? "authorization, content-type",
          "Access-Control-Max-Age": "600",
          Vary: "Origin",
        },
      });
    }
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normal = await normalizeCatastrophicSsrResponse(response);
      return cors ? comCors(normal, cors) : normal;
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
