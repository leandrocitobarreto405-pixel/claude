/**
 * Contexto do marketing por empresa: configuração, caixa do WhatsApp no Chatwoot e tokens.
 * Tudo com a chave de serviço (rotinas do servidor); as telas chamam depois de conferir a empresa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Conta } from "@/lib/alice/chatwoot-api.server";

export type Db = SupabaseClient<Database>;
export type ConfigMkt = Database["public"]["Tables"]["mkt_configuracoes"]["Row"];

export type ContextoEmpresa = {
  empresaId: string;
  cfg: ConfigMkt;
  conta: Conta;
  caixa: number;
  tokenAdmin: string | null;
  tokenRobo: string | null;
  aliceAtiva: boolean;
};

export function log(severity: "INFO" | "WARNING" | "ERROR", evento: string, dados: object) {
  const linha = JSON.stringify({ severity, message: `[mkt] ${evento}`, evento, ...dados });
  if (severity === "ERROR") console.error(linha);
  else if (severity === "WARNING") console.warn(linha);
  else console.log(linha);
}

export async function dbServico(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

/** RPC sem a checagem de tipos dos argumentos (os opcionais do banco aceitam null). */
export async function rpc<T = unknown>(
  db: Db,
  nome: string,
  args: Record<string, unknown>,
): Promise<T> {
  const chamar = db.rpc as unknown as (
    n: string,
    a: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await chamar.call(db, nome, args);
  if (error) throw error;
  return data as T;
}

export async function configMkt(db: Db, empresaId: string): Promise<ConfigMkt> {
  const { data, error } = await db
    .from("mkt_configuracoes")
    .select("*")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  // Sem linha ainda: cria com os padrões (tudo desligado).
  const { data: nova, error: e2 } = await db
    .from("mkt_configuracoes")
    .upsert({ empresa_id: empresaId }, { onConflict: "empresa_id" })
    .select("*")
    .single();
  if (e2) throw e2;
  return nova;
}

export async function contextoEmpresa(db: Db, empresaId: string): Promise<ContextoEmpresa> {
  const cfg = await configMkt(db, empresaId);
  let q = db
    .from("chatwoot_inboxes")
    .select("inbox_id, conexao_id")
    .eq("empresa_id", empresaId)
    .eq("ativo", true);
  if (cfg.chatwoot_inbox_id) q = q.eq("inbox_id", cfg.chatwoot_inbox_id);
  const { data: caixas, error } = await q;
  if (error) throw error;
  if (!caixas?.length) throw new Error("empresa sem caixa do WhatsApp ligada ao Chatwoot");
  if (caixas.length > 1)
    throw new Error("empresa com mais de uma caixa: escolha a caixa das campanhas na configuração");
  const { inbox_id, conexao_id } = caixas[0]!;
  const [{ data: conexao }, { data: segredos }, { data: ia }] = await Promise.all([
    db.from("chatwoot_conexoes").select("base_url, account_id").eq("id", conexao_id).single(),
    db
      .from("chatwoot_conexao_segredos")
      .select("alice_bot_token, api_token")
      .eq("conexao_id", conexao_id)
      .maybeSingle(),
    db.from("ia_configuracoes").select("ativo").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  if (!conexao) throw new Error("conexão do Chatwoot não encontrada");
  return {
    empresaId,
    cfg,
    conta: { baseUrl: conexao.base_url, accountId: Number(conexao.account_id) },
    caixa: Number(inbox_id),
    tokenAdmin: segredos?.api_token ?? null,
    tokenRobo: segredos?.alice_bot_token ?? null,
    aliceAtiva: Boolean(ia?.ativo),
  };
}
