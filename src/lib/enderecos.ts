/**
 * Endereços oficiais do Nexa.
 *
 * - App (o que as pessoas abrem, links de convite e de senha): https://app.nexaperformanceos.com.br,
 *   servido pelo Firebase Hosting, que repassa para o Cloud Run.
 * - Servidor direto (Cloud Run): webhooks (Chatwoot, Meta, robô da Alice, leads) e rotinas
 *   agendadas, e as chamadas pesadas do app (envio de foto/vídeo, importação, gerar documento):
 *   o Firebase corta em 60 s.
 *
 * Em desenvolvimento (localhost/127.0.0.1) tudo fica no próprio endereço.
 */
export const ENDERECO_APP = "https://app.nexaperformanceos.com.br";
export const ENDERECO_SERVIDOR = "https://nexaos-980094719320.southamerica-east1.run.app";

/** Origens que podem chamar o servidor direto (CORS). */
export const ORIGENS_DO_APP = [ENDERECO_APP, ENDERECO_SERVIDOR];

const ehLocal = (origem: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem);

function origemAtual(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}

/** Endereço do app para links que vão para pessoas (convite, senha, confirmação de conta). */
export function enderecoDoApp(): string {
  const o = origemAtual();
  if (o && ehLocal(o)) return o;
  if (!o && typeof process !== "undefined" && process.env?.["APP_URL_PUBLICA"])
    return process.env["APP_URL_PUBLICA"].replace(/\/+$/, "");
  return ENDERECO_APP;
}

/** Endereço dos webhooks e rotinas agendadas: sempre o Cloud Run direto (sem o limite de 60 s). */
export function enderecoDosWebhooks(): string {
  const o = origemAtual();
  if (o && ehLocal(o)) return o;
  return ENDERECO_SERVIDOR;
}

/**
 * `fetch` para chamadas pesadas do app: aberto pelo domínio do app, vai direto ao Cloud Run (com
 * CORS liberado só para as origens do app); em qualquer outro endereço, segue normal.
 * Uso: `await enviarMidia({ data: form, fetch: fetchDireto })`.
 */
export const fetchDireto: typeof fetch = (input, init) => {
  const o = origemAtual();
  if (!o || o === ENDERECO_SERVIDOR || ehLocal(o)) return fetch(input, init);
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  return fetch(new URL(url, ENDERECO_SERVIDOR).toString(), init);
};
