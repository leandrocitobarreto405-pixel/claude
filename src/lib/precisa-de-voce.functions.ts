import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa, requireEmpresaGravavel } from "@/lib/empresa.middleware";
import type { PrecisaDeVoce } from "@/lib/precisa-de-voce";
import type { Papel } from "@/lib/tenant";

// "Precisa de você" (item F): junta o que já existe no banco (só leitura) e calcula o dono.

const PAPEIS: Papel[] = ["admin", "atendente", "tecnico"];
const ID = /^[0-9a-f-]{36}$/i;

async function papelDe(db: { rpc: (f: never) => PromiseLike<{ data: unknown }> }) {
  const { data } = await db.rpc("meu_papel" as never);
  return PAPEIS.includes(data as Papel) ? (data as Papel) : null;
}

export const precisaDeVoceFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<PrecisaDeVoce> => {
    const papel = await papelDe(context.supabase as never);
    const souAdmin = papel === "admin";
    const vazio: PrecisaDeVoce = {
      itens: [],
      semDesfecho: { quantidade: 0, valor: 0 },
      souAdmin,
      meuId: context.userId,
      pessoas: [],
    };
    if (papel !== "admin" && papel !== "atendente") return vazio;
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const emp = context.empresaId;
    const agora = new Date();

    const { coletarItens } = await import("@/lib/precisa-de-voce.server");
    const [itens, semDesfecho, equipe] = await Promise.all([
      coletarItens(db, emp, agora),
      context.supabase.rpc("leads_sem_desfecho" as never),
      souAdmin
        ? db.from("usuarios_empresa").select("user_id, papel").eq("empresa_id", emp)
        : Promise.resolve({ data: [] as Array<{ user_id: string; papel: string }> }),
    ]);

    const sd = ((semDesfecho.data ?? []) as unknown as Array<{ valor: number | null }>) ?? [];
    let pessoas: PrecisaDeVoce["pessoas"] = [];
    const ids = (equipe.data ?? [])
      .filter((u) => u.papel === "admin" || u.papel === "atendente")
      .map((u) => u.user_id);
    if (ids.length) {
      const { data: perfis } = await db
        .from("users_profiles")
        .select("id, full_name, email")
        .in("id", ids);
      pessoas = ids
        .map((id) => {
          const p = (perfis ?? []).find((x) => x.id === id);
          return { id, nome: p?.full_name || p?.email || "Sem nome" };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome));
    }
    return {
      itens,
      semDesfecho: {
        quantidade: sd.length,
        valor: sd.reduce((s, l) => s + Number(l.valor ?? 0), 0),
      },
      souAdmin,
      meuId: context.userId,
      pessoas,
    };
  });

/** Aviso urgente resolvido (sai do bloco e do sininho). */
export const resolverAvisoPrecisaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresaGravavel])
  .inputValidator((input: { id: string }) => {
    if (!ID.test(input.id)) throw new Error("Aviso inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const papel = await papelDe(context.supabase as never);
    if (papel !== "admin" && papel !== "atendente") throw new Error("Sem acesso.");
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const { error } = await db
      .from("mkt_avisos")
      .update({ lido_em: new Date().toISOString() })
      .eq("id", data.id)
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });

/** Follow-up da equipe feito. */
export const concluirFollowupEquipeFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresaGravavel])
  .inputValidator((input: { id: string }) => {
    if (!ID.test(input.id)) throw new Error("Follow-up inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const papel = await papelDe(context.supabase as never);
    if (papel !== "admin" && papel !== "atendente") throw new Error("Sem acesso.");
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const { error } = await db
      .from("crm_followups")
      .update({
        status: "Concluída",
        completed_at: new Date().toISOString(),
        result: "feito pela equipe (Precisa de você)",
      })
      .eq("id", data.id)
      .eq("empresa_id", context.empresaId)
      .eq("responsavel", "equipe");
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });
