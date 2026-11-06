/**
 * Código comum das Edge Functions do app "Nexa OS" na Meta (WhatsApp Cloud API, Cadastro
 * Incorporado). Só usa Web Crypto, fetch, TextEncoder e atob/btoa: roda no Deno (Supabase) e no
 * Node (testes). Nada aqui lê secret sozinho: quem chama passa o valor.
 *
 * Separado da Turbine: o app da Turbine ("gestão Turbine Clean"), o Chatwoot e o webhook antigo não
 * usam nada daqui.
 */

export const META_APP_ID_PADRAO = "2330123227786041";
export const GRAPH_VERSAO_PADRAO = "v23.0";
export const ORIGEM_APP = "https://app.nexaperformanceos.com.br";

/** Número de teste da Meta no app Nexa OS (não é de cliente). */
export const TESTE_PHONE_ID = "1547429628435173";
export const TESTE_WABA_ID = "3641269396036529";

const enc = new TextEncoder();

/** Uint8Array como BufferSource (o TS novo separa ArrayBuffer de SharedArrayBuffer). */
const bs = (u: Uint8Array) => u as unknown as BufferSource;

// ---------------------------------------------------------------- base64

function paraBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function deBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** base64url (sem "=") → bytes, como no signed_request da Meta. */
export function deBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return deBase64(b64 + "===".slice((b64.length + 3) % 4));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação em tempo constante (não vaza onde a assinatura diverge). */
export function iguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

async function hmacSha256(segredo: string, dados: Uint8Array): Promise<Uint8Array> {
  const chave = await crypto.subtle.importKey(
    "raw",
    enc.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", chave, bs(dados)));
}

// ---------------------------------------------------------------- webhook

/**
 * Confere o cabeçalho X-Hub-Signature-256 ("sha256=<hex>") contra o HMAC-SHA256 do corpo cru com o
 * App Secret. Corpo cru = exatamente os bytes recebidos (não o JSON re-serializado).
 */
export async function assinaturaValida(
  appSecret: string,
  corpoCru: Uint8Array,
  cabecalho: string | null,
): Promise<boolean> {
  if (!appSecret || !cabecalho?.startsWith("sha256=")) return false;
  const recebida = cabecalho.slice(7).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(recebida)) return false;
  const esperada = hex(await hmacSha256(appSecret, corpoCru));
  return iguais(enc.encode(esperada), enc.encode(recebida));
}

/** GET de verificação: devolve o hub.challenge só se o modo e o verify token baterem. */
export function desafioDaVerificacao(params: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  const token = params.get("hub.verify_token") ?? "";
  if (!iguais(enc.encode(token), enc.encode(verifyToken))) return null;
  return params.get("hub.challenge");
}

export type LinhaEvento = {
  waba_id: string | null;
  phone_number_id: string | null;
  tipo: "mensagem" | "status" | "outro";
  wa_message_id: string | null;
  contato: string | null;
  texto: string | null;
  status: string | null;
  payload: unknown;
};

type ValorWhatsapp = {
  metadata?: { phone_number_id?: string };
  messages?: Array<Record<string, unknown>>;
  statuses?: Array<Record<string, unknown>>;
};

function textoDaMensagem(m: Record<string, unknown>): string | null {
  const t = m["type"];
  const corpo = (k: string, campo: string) =>
    ((m[k] as Record<string, unknown> | undefined)?.[campo] as string | undefined) ?? null;
  if (t === "text") return corpo("text", "body");
  if (t === "button") return corpo("button", "text");
  if (t === "interactive") {
    const i = m["interactive"] as Record<string, Record<string, unknown>> | undefined;
    return (
      (i?.["button_reply"]?.["title"] as string | undefined) ??
      (i?.["list_reply"]?.["title"] as string | undefined) ??
      null
    );
  }
  for (const k of ["image", "video", "document", "audio", "sticker"]) {
    if (t === k) return corpo(k, "caption") ?? `[${k}]`;
  }
  return typeof t === "string" ? `[${t}]` : null;
}

/** Uma linha por mensagem e por status; mudança sem mensagem/status vira "outro". */
export function linhasDoWebhook(corpo: unknown): LinhaEvento[] {
  const linhas: LinhaEvento[] = [];
  const entradas = (corpo as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entradas)) return linhas;
  for (const e of entradas as Array<{ id?: string; changes?: unknown[] }>) {
    const waba = typeof e.id === "string" ? e.id : null;
    for (const c of (e.changes ?? []) as Array<{ field?: string; value?: ValorWhatsapp }>) {
      const v = c.value ?? {};
      const phone = v.metadata?.phone_number_id ?? null;
      let algum = false;
      for (const m of v.messages ?? []) {
        algum = true;
        const texto = textoDaMensagem(m);
        linhas.push({
          waba_id: waba,
          phone_number_id: phone,
          tipo: "mensagem",
          wa_message_id: (m["id"] as string) ?? null,
          contato: ((m["from"] as string) ?? "").replace(/\D/g, "") || null,
          texto: texto ? texto.slice(0, 4096) : null,
          status: null,
          payload: { field: c.field, metadata: v.metadata, message: m },
        });
      }
      for (const s of v.statuses ?? []) {
        algum = true;
        linhas.push({
          waba_id: waba,
          phone_number_id: phone,
          tipo: "status",
          wa_message_id: (s["id"] as string) ?? null,
          contato: ((s["recipient_id"] as string) ?? "").replace(/\D/g, "") || null,
          texto: null,
          status: (s["status"] as string) ?? null,
          payload: { field: c.field, metadata: v.metadata, status: s },
        });
      }
      if (!algum) {
        linhas.push({
          waba_id: waba,
          phone_number_id: phone,
          tipo: "outro",
          wa_message_id: null,
          contato: null,
          texto: null,
          status: null,
          payload: { field: c.field, value: v },
        });
      }
    }
  }
  return linhas;
}

// ---------------------------------------------------------------- signed_request (exclusão)

/**
 * signed_request da Meta: "<assinatura base64url>.<payload base64url>", assinado com HMAC-SHA256
 * do payload (como texto) e o App Secret. Devolve o payload (com user_id) ou null se inválido.
 */
export async function lerSignedRequest(
  signedRequest: string,
  appSecret: string,
): Promise<{ user_id: string; [k: string]: unknown } | null> {
  if (!appSecret || typeof signedRequest !== "string") return null;
  const [sig, dados] = signedRequest.split(".", 2);
  if (!sig || !dados) return null;
  let payload: { algorithm?: string; user_id?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(deBase64Url(dados)));
  } catch {
    return null;
  }
  if (String(payload.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return null;
  const esperada = await hmacSha256(appSecret, enc.encode(dados));
  let recebida: Uint8Array;
  try {
    recebida = deBase64Url(sig);
  } catch {
    return null;
  }
  if (!iguais(esperada, recebida)) return null;
  const uid = payload.user_id;
  if (typeof uid !== "string" && typeof uid !== "number") return null;
  return { ...(payload as Record<string, unknown>), user_id: String(uid) };
}

/** Código de acompanhamento do pedido de exclusão (letras maiúsculas e números). */
export function gerarCodigo(tamanho = 16): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(tamanho));
  return [...bytes].map((b) => alfabeto[b % alfabeto.length]).join("");
}

/** PIN de 6 dígitos do registro do número (verificação em duas etapas). */
export function gerarPin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, "0");
}

// ---------------------------------------------------------------- criptografia do token

async function chaveAes(chaveBase64: string): Promise<CryptoKey> {
  const bruta = deBase64(chaveBase64.trim());
  if (bruta.length !== 32) throw new Error("NEXA_META_TOKEN_KEY precisa ter 32 bytes em base64.");
  return crypto.subtle.importKey("raw", bs(bruta), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM: "v1.<iv base64>.<cifrado base64>". O texto aberto nunca vai ao banco. */
export async function cifrar(texto: string, chaveBase64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bs(iv) },
    await chaveAes(chaveBase64),
    bs(enc.encode(texto)),
  );
  return `v1.${paraBase64(iv)}.${paraBase64(new Uint8Array(c))}`;
}

export async function decifrar(cifrado: string, chaveBase64: string): Promise<string> {
  const [v, iv, c] = cifrado.split(".");
  if (v !== "v1" || !iv || !c) throw new Error("Segredo em formato desconhecido.");
  const aberto = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bs(deBase64(iv)) },
    await chaveAes(chaveBase64),
    bs(deBase64(c)),
  );
  return new TextDecoder().decode(aberto);
}

// ---------------------------------------------------------------- Graph API

export type RespostaGraph = { ok: boolean; status: number; dados: Record<string, unknown> };

/**
 * Chamada à Graph API. O token vai no cabeçalho (nunca na URL do log). Erro devolve só a mensagem
 * da Meta, sem token.
 */
export async function graph(
  caminho: string,
  o: {
    token?: string;
    metodo?: "GET" | "POST" | "DELETE";
    corpo?: unknown;
    params?: Record<string, string>;
    versao?: string;
    base?: string;
  } = {},
): Promise<RespostaGraph> {
  const base = (o.base ?? "https://graph.facebook.com").replace(/\/$/, "");
  const url = new URL(`${base}/${o.versao ?? GRAPH_VERSAO_PADRAO}/${caminho.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(o.params ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (o.token) headers["Authorization"] = `Bearer ${o.token}`;
  if (o.corpo !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(url.toString(), {
    method: o.metodo ?? "GET",
    headers,
    ...(o.corpo !== undefined ? { body: JSON.stringify(o.corpo) } : {}),
  });
  let dados: Record<string, unknown> = {};
  try {
    dados = (await r.json()) as Record<string, unknown>;
  } catch {
    dados = {};
  }
  return { ok: r.ok && !dados["error"], status: r.status, dados };
}

/** Mensagem de erro da Meta para mostrar (sem token, até 300 caracteres). */
export function erroDaMeta(r: RespostaGraph): string {
  const e = r.dados["error"] as { message?: string; code?: number } | undefined;
  const msg = e?.message ?? `Erro ${r.status} na Meta.`;
  return `${msg}${e?.code ? ` (código ${e.code})` : ""}`
    .replace(/EAA[A-Za-z0-9]+/g, "[token]")
    .slice(0, 300);
}

// ---------------------------------------------------------------- respostas HTTP

export function cabecalhosCors(origem: string | null): Record<string, string> {
  const permitidas = [ORIGEM_APP, "http://localhost:8080", "http://127.0.0.1:8083"];
  const o = origem && permitidas.includes(origem) ? origem : ORIGEM_APP;
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-empresa-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(corpo: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}
