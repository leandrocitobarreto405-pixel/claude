/**
 * "Avisar a Tatiana" (Parte D2): na conversa, a pessoa grava uma frase sobre um erro ou acerto; o
 * admin vê todos na aba Avisos da tela da Tatiana, com quem mandou e o que virou (sugestão da
 * revisão semanal aprovada ou recusada). Nada é enviado a clientes e nada muda na Alice.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";

type Db = SupabaseClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TipoAviso = "erro" | "acerto";
export type VirouAviso =
  | { situacao: "aguardando" }
  | { situacao: "sem_sugestao" }
  | { situacao: "sugestao"; sugestao: string; decisao: "aprovada" | "recusada" | "pendente" };

export type AvisoTela = {
  id: string;
  tipo: TipoAviso;
  frase: string;
  criadoEm: string;
  conversaId: string | null;
  quem: string | null;
  telefoneFinal: string | null;
  virou: VirouAviso;
};

/** O que o aviso virou, lendo a sugestão e a decisão do relatório da revisão semanal. */
export function virouDoAviso(
  a: { relatorio_id: string | null; sugestao_indice: number | null; revisado_em: string | null },
  relatorios: Map<
    string,
    {
      sugestoes: Array<{ sugestao: string }>;
      decisoes: Record<string, { decisao: "aprovada" | "recusada" }>;
    }
  >,
): VirouAviso {
  if (a.relatorio_id && a.sugestao_indice !== null) {
    const r = relatorios.get(a.relatorio_id);
    const s = r?.sugestoes[a.sugestao_indice];
    if (s)
      return {
        situacao: "sugestao",
        sugestao: s.sugestao,
        decisao: r?.decisoes[String(a.sugestao_indice)]?.decisao ?? "pendente",
      };
  }
  return a.revisado_em ? { situacao: "sem_sugestao" } : { situacao: "aguardando" };
}

export const avisarTatianaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((d: { conversaId: string; tipo: string; frase: string }) => {
    const conversaId = String(d.conversaId ?? "");
    if (!UUID.test(conversaId)) throw new Error("Conversa inválida.");
    if (d.tipo !== "erro" && d.tipo !== "acerto") throw new Error("Escolha erro ou acerto.");
    const frase = String(d.frase ?? "").trim();
    if (frase.length < 3) throw new Error("Escreva uma frase sobre o que aconteceu.");
    return { conversaId, tipo: d.tipo as TipoAviso, frase: frase.slice(0, 300) };
  })
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as Db;
    const { error } = await db.rpc("comercial_avisar", {
      _conversa: data.conversaId,
      _tipo: data.tipo,
      _frase: data.frase,
    });
    if (error) throw new Error(error.message || "Não foi possível gravar o aviso.");
    return { ok: true };
  });

async function lerAvisos(db: Db, empresaId: string, so?: string): Promise<AvisoTela[]> {
  let q = db
    .from("comercial_avisos")
    .select(
      "id, tipo, frase, criado_em, conversa_id, crm_lead_id, user_id, relatorio_id, sugestao_indice, revisado_em",
    )
    .eq("empresa_id", empresaId)
    .gte("criado_em", new Date(Date.now() - 60 * 86_400_000).toISOString())
    .order("criado_em", { ascending: false })
    .limit(so ? 5 : 300);
  if (so) q = q.eq("user_id", so);
  const { data: rows } = await q;
  const avisos = (rows ?? []) as Array<{
    id: string;
    tipo: TipoAviso;
    frase: string;
    criado_em: string;
    conversa_id: string | null;
    crm_lead_id: string | null;
    user_id: string;
    relatorio_id: string | null;
    sugestao_indice: number | null;
    revisado_em: string | null;
  }>;
  const relIds = [...new Set(avisos.map((a) => a.relatorio_id).filter(Boolean))] as string[];
  const leadIds = [...new Set(avisos.map((a) => a.crm_lead_id).filter(Boolean))] as string[];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const adm = supabaseAdmin as unknown as Db;
  const [{ data: rels }, { data: leads }, nomes] = await Promise.all([
    relIds.length
      ? adm
          .from("comercial_relatorios")
          .select("id, dados")
          .eq("empresa_id", empresaId)
          .in("id", relIds)
      : Promise.resolve({ data: [] }),
    leadIds.length
      ? db.from("crm_leads").select("id, normalized_phone").in("id", leadIds)
      : Promise.resolve({ data: [] }),
    (async () => {
      const { pessoasDaEmpresa } = await import("@/lib/comercial/noite.server");
      const ps = await pessoasDaEmpresa(adm, empresaId);
      return new Map(ps.map((p) => [p.userId, p.nome]));
    })(),
  ]);
  const relatorios = new Map(
    (
      (rels ?? []) as Array<{
        id: string;
        dados: {
          leitura?: { sugestoes?: Array<{ sugestao: string }> };
          decisoes?: Record<string, { decisao: "aprovada" | "recusada" }>;
        };
      }>
    ).map((r) => [
      r.id,
      { sugestoes: r.dados?.leitura?.sugestoes ?? [], decisoes: r.dados?.decisoes ?? {} },
    ]),
  );
  const fone = new Map(
    ((leads ?? []) as Array<{ id: string; normalized_phone: string | null }>).map((l) => [
      l.id,
      l.normalized_phone ? l.normalized_phone.slice(-4) : null,
    ]),
  );
  return avisos.map((a) => ({
    id: a.id,
    tipo: a.tipo,
    frase: a.frase,
    criadoEm: a.criado_em,
    conversaId: a.conversa_id,
    quem: nomes.get(a.user_id) || null,
    telefoneFinal: a.crm_lead_id ? (fone.get(a.crm_lead_id) ?? null) : null,
    virou: virouDoAviso(a, relatorios),
  }));
}

/** Os últimos avisos da própria pessoa (no diálogo da conversa). */
export const meusAvisosFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<AvisoTela[]> => {
    return lerAvisos(
      context.supabase as unknown as Db,
      context.empresaId as string,
      context.userId as string,
    );
  });

/** Todos os avisos dos últimos 60 dias (só admin, aba Avisos da Tatiana). */
export const avisosTatianaFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<AvisoTela[]> =>
    lerAvisos(context.supabase as unknown as Db, context.empresaId as string),
  );
