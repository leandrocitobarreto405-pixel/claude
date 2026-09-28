import { createHmac, timingSafeEqual } from "node:crypto";
import { contextoEmpresa } from "@/lib/request-db.server";

/**
 * Conta Google de cada empresa (OAuth), no lugar do conector do Lovable.
 *
 * A Nexa cria uma vez o cliente OAuth no Google Cloud (GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET
 * no Cloud Run). Cada empresa conecta a própria conta em Configurações; o token de renovação
 * fica em google_conexao_segredos (só a chave de serviço lê) e o token de acesso é renovado
 * aqui, com cache por empresa.
 */

/** Drive (inclui a API do Docs) e eventos da agenda; e-mail para mostrar a conta conectada. */
export const ESCOPOS_GOOGLE = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar.events",
];

export const ESCOPOS_OBRIGATORIOS = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar.events",
];

const PRAZO_AUTORIZACAO_MS = 15 * 60 * 1000;

export function credenciaisGoogle(): { id: string; segredo: string } | null {
  const id = process.env["GOOGLE_CLIENT_ID"];
  const segredo = process.env["GOOGLE_CLIENT_SECRET"];
  return id && segredo ? { id, segredo } : null;
}

function exigirCredenciais() {
  const c = credenciaisGoogle();
  if (!c) {
    throw new Error(
      "O acesso ao Google ainda não foi configurado no servidor (GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET).",
    );
  }
  return c;
}

export const CAMINHO_RETORNO = "/api/public/google/retorno";

// ---------------------------------------------------------------- estado da autorização
export type EstadoAutorizacao = {
  empresaId: string;
  userId: string;
  redirectUri: string;
  expiraEm: number;
};

function assinar(conteudo: string, segredo: string) {
  return createHmac("sha256", segredo).update(conteudo).digest("base64url");
}

export function criarEstado(dados: EstadoAutorizacao, segredo: string): string {
  const conteudo = Buffer.from(JSON.stringify(dados)).toString("base64url");
  return `${conteudo}.${assinar(conteudo, segredo)}`;
}

/** Confere assinatura e prazo do "state" que volta do Google. */
export function lerEstado(
  estado: string,
  segredo: string,
  agora = Date.now(),
): EstadoAutorizacao | null {
  const [conteudo, assinatura] = estado.split(".");
  if (!conteudo || !assinatura) return null;
  const esperado = Buffer.from(assinar(conteudo, segredo));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
  try {
    const dados = JSON.parse(Buffer.from(conteudo, "base64url").toString()) as EstadoAutorizacao;
    if (typeof dados.expiraEm !== "number" || dados.expiraEm < agora) return null;
    if (!dados.empresaId || !dados.userId || !dados.redirectUri) return null;
    return dados;
  } catch {
    return null;
  }
}

/** Endereço de retorno a partir da origem do app (https, ou http só em 127.0.0.1/localhost). */
export function enderecoRetorno(origem: string): string {
  const url = new URL(origem);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Endereço do app inválido para conectar ao Google.");
  }
  return `${url.origin}${CAMINHO_RETORNO}`;
}

export function urlAutorizacao(input: { empresaId: string; userId: string; origem: string }) {
  const { id, segredo } = exigirCredenciais();
  const redirectUri = enderecoRetorno(input.origem);
  const state = criarEstado(
    {
      empresaId: input.empresaId,
      userId: input.userId,
      redirectUri,
      expiraEm: Date.now() + PRAZO_AUTORIZACAO_MS,
    },
    segredo,
  );
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: ESCOPOS_GOOGLE.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ---------------------------------------------------------------- troca e renovação de tokens
type RespostaToken = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
};

async function pedirToken(corpo: Record<string, string>): Promise<RespostaToken> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(corpo),
  });
  const json = (await res.json().catch(() => ({}))) as RespostaToken;
  if (!res.ok) return { error: json.error ?? `http_${res.status}` };
  return json;
}

/** E-mail da conta, lido do id_token recebido diretamente do Google. */
export function emailDoIdToken(idToken: string | undefined): string | null {
  const parte = idToken?.split(".")[1];
  if (!parte) return null;
  try {
    const dados = JSON.parse(Buffer.from(parte, "base64url").toString()) as { email?: string };
    return dados.email ?? null;
  } catch {
    return null;
  }
}

export async function trocarCodigo(codigo: string, redirectUri: string) {
  const { id, segredo } = exigirCredenciais();
  return pedirToken({
    code: codigo,
    client_id: id,
    client_secret: segredo,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

export async function revogarToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
  }).catch(() => undefined);
}

const cache = new Map<string, { token: string; expiraEm: number }>();

export function esquecerTokenGoogle(empresaId: string) {
  cache.delete(empresaId);
}

/** Token de acesso da conta Google da empresa ativa. */
export async function tokenGoogle(): Promise<string> {
  const { empresaId } = contextoEmpresa();
  const guardado = cache.get(empresaId);
  if (guardado && guardado.expiraEm - Date.now() > 60_000) return guardado.token;

  const { id, segredo } = exigirCredenciais();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("google_conexao_segredos")
    .select("refresh_token")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!data?.refresh_token) {
    throw new Error(
      "Conecte a conta Google da empresa em Configurações → Modelos de ordem de serviço.",
    );
  }

  const r = await pedirToken({
    client_id: id,
    client_secret: segredo,
    refresh_token: data.refresh_token,
    grant_type: "refresh_token",
  });
  if (!r.access_token) {
    if (r.error === "invalid_grant") {
      await supabaseAdmin
        .from("google_conexoes")
        .update({
          situacao: "erro",
          erro: "A autorização do Google foi revogada ou expirou. Conecte a conta novamente.",
        })
        .eq("empresa_id", empresaId);
      throw new Error("A conta Google da empresa precisa ser conectada de novo (Configurações).");
    }
    throw new Error("Não foi possível autenticar no Google agora. Tente novamente.");
  }
  cache.set(empresaId, {
    token: r.access_token,
    expiraEm: Date.now() + (r.expires_in ?? 3600) * 1000,
  });
  return r.access_token;
}
