// Parte Deno (Supabase Edge Functions): clientes do banco, secrets e quem está chamando.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GRAPH_VERSAO_PADRAO, META_APP_ID_PADRAO, usarBaseGraph } from "./meta.ts";

declare const Deno: { env: { get(nome: string): string | undefined } };

function chave(nova: string, antiga: string): string {
  try {
    const k = JSON.parse(Deno.env.get(nova) ?? "{}")["default"];
    if (k) return k as string;
  } catch {
    // segue para a chave antiga
  }
  return Deno.env.get(antiga) ?? "";
}

export const URL_SUPABASE = Deno.env.get("SUPABASE_URL") ?? "";
// Ensaio local: Graph API falsa. Em produção a variável não existe.
usarBaseGraph(Deno.env.get("NEXA_META_GRAPH_URL"));
const CHAVE_SECRETA = chave("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const CHAVE_PUBLICA = chave("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");

/** Cliente do servidor (ignora RLS). Nunca sai da Edge Function. */
export function bancoServidor(): SupabaseClient {
  return createClient(URL_SUPABASE, CHAVE_SECRETA, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const segredo = (nome: string) => (Deno.env.get(nome) ?? "").trim();

export const config = () => ({
  appId: segredo("NEXA_META_APP_ID") || META_APP_ID_PADRAO,
  appSecret: segredo("NEXA_META_APP_SECRET"),
  verifyToken: segredo("NEXA_META_WEBHOOK_VERIFY_TOKEN"),
  chaveToken: segredo("NEXA_META_TOKEN_KEY"),
  configId: segredo("NEXA_META_ES_CONFIG_ID"),
  versao: segredo("NEXA_META_GRAPH_VERSION") || GRAPH_VERSAO_PADRAO,
  /** Token PERMANENTE do usuário do sistema da Nexa: o dia a dia (mensagens, modelos, perfil). */
  systemToken: segredo("NEXA_META_SYSTEM_TOKEN"),
  /** Número de teste: token próprio ou, sem ele, o do usuário do sistema. */
  tokenTeste: segredo("NEXA_META_TESTE_TOKEN") || segredo("NEXA_META_SYSTEM_TOKEN"),
});

export type Chamador = {
  userId: string;
  souNexa: boolean;
  /** Empresa ativa (cabeçalho x-empresa-id) quando quem chama é admin dela (ou Nexa). */
  empresaAdmin: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quem está chamando, pelo token do login do app. null = sem login válido. */
export async function chamador(req: Request, db: SupabaseClient): Promise<Chamador | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.startsWith("sb_")) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const userId = data.user.id;
  // sou_admin_nexa olha auth.uid(): chama com o token do próprio usuário.
  const doUsuario = createClient(URL_SUPABASE, CHAVE_PUBLICA, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: nexa } = await doUsuario.rpc("sou_admin_nexa");
  const souNexa = nexa === true;
  const pedida = req.headers.get("x-empresa-id") ?? "";
  let empresaAdmin: string | null = null;
  if (UUID.test(pedida)) {
    if (souNexa) empresaAdmin = pedida;
    else {
      const { data: v } = await db
        .from("usuarios_empresa")
        .select("papel")
        .eq("user_id", userId)
        .eq("empresa_id", pedida)
        .maybeSingle();
      if ((v as { papel?: string } | null)?.papel === "admin") empresaAdmin = pedida;
    }
  }
  return { userId, souNexa, empresaAdmin };
}
