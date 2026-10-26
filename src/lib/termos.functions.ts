// Aceite dos termos (decisão C). Quem grava é o servidor: o IP vem do pedido, nunca da tela.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ipDoPedido,
  lerTextoConfig,
  precisaAceitar,
  validarUrlTermos,
  validarVersao,
} from "@/lib/termos";

export const CHAVE_TERMOS = ["termos"] as const;

async function termosVigentes() {
  const { dbServico } = await import("@/lib/mkt/contexto.server");
  const db = await dbServico();
  const { data } = await db
    .from("configuracoes_plataforma")
    .select("chave, valor")
    .in("chave", ["termos_versao", "termos_url"]);
  const valor = (c: string) => lerTextoConfig(data?.find((x) => x.chave === c)?.valor);
  return { db, versao: valor("termos_versao"), url: valor("termos_url") };
}

/** Termos que a pessoa logada ainda precisa aceitar (null: nada a aceitar). */
export const termosPendentesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ versao: string; url: string | null } | null> => {
    const { db, versao, url } = await termosVigentes();
    if (!versao) return null;
    const { data } = await db
      .from("termos_aceites")
      .select("versao")
      .eq("user_id", context.userId)
      .eq("versao", versao);
    return precisaAceitar(
      versao,
      (data ?? []).map((a) => a.versao),
    )
      ? { versao, url }
      : null;
  });

export const aceitarTermosFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { versao: string }) => ({ versao: validarVersao(i.versao) }))
  .handler(async ({ data, context }) => {
    const { db, versao } = await termosVigentes();
    if (!versao || versao !== data.versao)
      throw new Error("Os termos mudaram. Recarregue a página para ver a versão atual.");
    const { getRequest } = await import("@tanstack/react-start/server");
    const pedido = getRequest();
    const { data: emp } = await context.supabase.rpc("empresa_ativa" as never);
    const { error } = await db.from("termos_aceites").upsert(
      {
        user_id: context.userId,
        versao,
        empresa_id: (emp as string | null) ?? null,
        ip: ipDoPedido(pedido.headers.get("x-forwarded-for"), pedido.headers.get("x-real-ip")),
        navegador: (pedido.headers.get("user-agent") ?? "").slice(0, 500) || null,
      },
      { onConflict: "user_id,versao", ignoreDuplicates: true },
    );
    if (error) throw new Error("Não foi possível registrar o aceite. Tente de novo.");
    return { ok: true };
  });

async function exigirNexa(supabase: { rpc: (fn: never) => PromiseLike<{ data: unknown }> }) {
  const { data } = await supabase.rpc("sou_admin_nexa" as never);
  if (data !== true) throw new Error("Só a Nexa altera os termos.");
}

/** Painel Nexa: versão vigente, link e quantos aceitaram. */
export const termosConfigFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirNexa(context.supabase);
    const { db, versao, url } = await termosVigentes();
    const { count } = versao
      ? await db
          .from("termos_aceites")
          .select("id", { count: "exact", head: true })
          .eq("versao", versao)
      : { count: 0 };
    return { versao, url, aceites: count ?? 0 };
  });

export const salvarTermosConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { versao: string; url: string }) => ({
    versao: validarVersao(i.versao),
    url: validarUrlTermos(i.url),
  }))
  .handler(async ({ data, context }) => {
    await exigirNexa(context.supabase);
    const { error } = await context.supabase.from("configuracoes_plataforma").upsert([
      { chave: "termos_versao", valor: data.versao },
      { chave: "termos_url", valor: data.url },
    ]);
    if (error) throw new Error(`Não foi possível salvar: ${error.message}`);
    return { ok: true };
  });
