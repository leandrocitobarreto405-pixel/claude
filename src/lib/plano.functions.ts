/**
 * "Quero mudar de plano": registra o pedido para a Nexa (sininho do Painel Nexa). Não muda o plano
 * nem cobra nada; quem muda é a Nexa. Pedidos da Nexa: listar e marcar como visto.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import { requireNexaAdmin } from "@/lib/nexa.middleware";
import { CHAVES_RECURSO, type Recurso } from "@/lib/recursos";

export const pedirMudancaPlanoFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((i: { recurso?: string | null; plano?: string | null }) => ({
    recurso: CHAVES_RECURSO.includes(i?.recurso as Recurso) ? (i.recurso as Recurso) : null,
    plano: /^[a-z_]{2,40}$/.test(String(i?.plano ?? "")) ? String(i.plano) : null,
  }))
  .handler(async ({ data, context }) => {
    // Um pedido em aberto por empresa e recurso basta.
    const { count } = await context.supabase
      .from("pedidos_plano")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", context.empresaId)
      .is("visto_em", null)
      .eq("recurso", data.recurso ?? "");
    if ((count ?? 0) > 0) return { ok: true, repetido: true };
    const { error } = await context.supabase.from("pedidos_plano").insert({
      empresa_id: context.empresaId,
      user_id: context.userId,
      recurso: data.recurso,
      plano_sugerido: data.plano,
    } as never);
    if (error) throw new Error("Não foi possível avisar a Nexa agora. Tente de novo.");
    return { ok: true, repetido: false };
  });

export type PedidoPlano = {
  id: string;
  empresa: string;
  recurso: string | null;
  plano_sugerido: string | null;
  criado_em: string;
};

export const pedidosPlanoNexaFn = createServerFn({ method: "GET" })
  .middleware([requireNexaAdmin])
  .handler(async ({ context }): Promise<PedidoPlano[]> => {
    const { data } = await context.supabase
      .from("pedidos_plano")
      .select("id, recurso, plano_sugerido, criado_em, empresa:empresa_id ( nome )")
      .is("visto_em", null)
      .order("criado_em", { ascending: false })
      .limit(50);
    return (
      (data ?? []) as unknown as Array<
        Omit<PedidoPlano, "empresa"> & { empresa: { nome: string } | null }
      >
    ).map((p) => ({ ...p, empresa: p.empresa?.nome ?? "Empresa" }));
  });

export const marcarPedidoVistoFn = createServerFn({ method: "POST" })
  .middleware([requireNexaAdmin])
  .inputValidator((i: { id: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(String(i?.id))) throw new Error("Pedido inválido.");
    return { id: String(i.id) };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("pedidos_plano")
      .update({ visto_em: new Date().toISOString(), visto_por: context.userId } as never)
      .eq("id", data.id);
    if (error) throw new Error("Não foi possível marcar como visto.");
    return { ok: true };
  });
