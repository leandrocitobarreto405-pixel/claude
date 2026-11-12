/**
 * Classificação da Tatiana por lead, para os selos das telas do CRM (12/11). A ficha da Tatiana só
 * é lida direto pelo admin; aqui a equipe de atendimento recebe só o número da classificação.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lead → classificação (1 a 9). Sem `ids`: todos os leads lidos da empresa. */
export const classificacaoDosLeadsFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((d: { ids?: string[] | null }) => ({
    ids: d?.ids ? d.ids.filter((x) => ID.test(x)).slice(0, 1000) : null,
  }))
  .handler(async ({ context, data }): Promise<Record<string, number>> => {
    const { data: papel } = await (context.supabase as unknown as Db).rpc("meu_papel");
    if (papel !== "admin" && papel !== "atendente") return {};
    if (data.ids && !data.ids.length) return {};
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const saida: Record<string, number> = {};
    const emp = context.empresaId as string;
    const ler = async (ids: string[] | null) => {
      let q = (supabaseAdmin as unknown as Db)
        .from("comercial_analises")
        .select("crm_lead_id, caixinha")
        .eq("empresa_id", emp)
        .not("caixinha", "is", null)
        .limit(5000);
      if (ids) q = q.in("crm_lead_id", ids);
      const { data: linhas, error } = await q;
      if (error) throw new Error(error.message);
      for (const l of (linhas ?? []) as Array<{ crm_lead_id: string; caixinha: number }>)
        saida[l.crm_lead_id] = l.caixinha;
    };
    if (!data.ids) await ler(null);
    else for (let i = 0; i < data.ids.length; i += 200) await ler(data.ids.slice(i, i + 200));
    return saida;
  });
