/**
 * Configurações › Vendas › Tatiana (gerente comercial), 10/11 (plano aprovado pelo dono):
 *  - o admin da empresa liga e desliga a Tatiana e vê se está ligada, o que ela fez na última
 *    noite e quantas tarefas criou;
 *  - custo em dólar, teto do mês e projeção: só a equipe da Nexa vê e muda.
 * A Tatiana só existe na empresa em que a Nexa a liberou (linha em comercial_configuracoes com o
 * gerente comercial ligado); sem isso a seção mostra "não liberada".
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminEmpresa } from "@/lib/empresa.middleware";
import { projecaoDoMes } from "@/lib/tatiana-config";

type Db = SupabaseClient;

export type UltimaNoite = {
  noite: string;
  status: string;
  leads: number;
  tarefas: number;
  concluidaEm: string | null;
};

export type TatianaConfig = {
  liberada: boolean;
  ligada: boolean;
  modo: string | null;
  ultimaNoite: UltimaNoite | null;
  /** Tarefas que a Tatiana criou no mês (soma das noites). */
  tarefasNoMes: number;
  /** Só para a Nexa (null para o admin da empresa). */
  custos: {
    tetoUsd: number;
    noitesNoMesUsd: number;
    totalNoMesUsd: number;
    projecaoUsd: number;
    ultimaNoiteUsd: number | null;
  } | null;
};

/** Regra única da Nexa (nexa-admin.ts); aqui só decide se mostra o custo. */
async function souNexa(db: Db): Promise<boolean> {
  const { exigirNexaAdmin } = await import("@/lib/nexa-admin");
  return exigirNexaAdmin(db as never).then(
    () => true,
    () => false,
  );
}

function hojeSP(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export const tatianaConfigFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<TatianaConfig> => {
    const db = context.supabase as unknown as Db;
    const emp = context.empresaId as string;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adm = supabaseAdmin as unknown as Db;
    const hoje = hojeSP();
    const mes = hoje.slice(0, 7);
    const [{ data: cfg }, { data: noites }, nexa] = await Promise.all([
      adm
        .from("comercial_configuracoes")
        .select("ligado, modo, teto_mensal_usd")
        .eq("empresa_id", emp)
        .maybeSingle(),
      adm
        .from("comercial_noites")
        .select("noite, status, processados, custo_usd, resumo, concluida_em, modo")
        .eq("empresa_id", emp)
        .gte("noite", `${mes}-01`)
        .neq("modo", "conferencia")
        .order("noite", { ascending: false }),
      souNexa(db),
    ]);
    const c = cfg as { ligado: boolean; modo: string; teto_mensal_usd: number | string } | null;
    const lista = (noites ?? []) as Array<{
      noite: string;
      status: string;
      processados: number;
      custo_usd: number | string;
      resumo: { tarefas?: number } | null;
      concluida_em: string | null;
    }>;
    const tarefasDe = (n: (typeof lista)[number]) => Number(n.resumo?.tarefas ?? 0) || 0;
    const ultima = lista[0] ?? null;
    let custos: TatianaConfig["custos"] = null;
    if (nexa && c) {
      const { data: tot } = await db.rpc(
        "tatiana_consumo_empresas" as never,
        { _mes: `${mes}-01` } as never,
      );
      const total = Number(
        ((tot ?? []) as Array<{ empresa_id: string; tatiana_custo_usd: number | string }>).find(
          (l) => l.empresa_id === emp,
        )?.tatiana_custo_usd ?? 0,
      );
      const noitesUsd = lista.reduce((s, n) => s + Number(n.custo_usd ?? 0), 0);
      custos = {
        tetoUsd: Number(c.teto_mensal_usd),
        noitesNoMesUsd: Math.round(noitesUsd * 100) / 100,
        totalNoMesUsd: Math.round(total * 100) / 100,
        projecaoUsd: projecaoDoMes(
          lista.map((n) => Number(n.custo_usd ?? 0)),
          noitesUsd,
          hoje,
        ),
        ultimaNoiteUsd: ultima ? Math.round(Number(ultima.custo_usd) * 100) / 100 : null,
      };
    }
    return {
      liberada: Boolean(c?.ligado),
      ligada: Boolean(c?.ligado) && c?.modo !== "desligado",
      modo: c?.modo ?? null,
      ultimaNoite: ultima
        ? {
            noite: ultima.noite,
            status: ultima.status,
            leads: ultima.processados,
            tarefas: tarefasDe(ultima),
            concluidaEm: ultima.concluida_em,
          }
        : null,
      tarefasNoMes: lista.reduce((s, n) => s + tarefasDe(n), 0),
      custos,
    };
  });

/** Admin da empresa (ou Nexa) liga e desliga. Ligar volta ao modo ativo. */
export const tatianaLigarFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((d: { ligar: boolean }) => ({ ligar: d?.ligar === true }))
  .handler(async ({ context, data }) => {
    const emp = context.empresaId as string;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adm = supabaseAdmin as unknown as Db;
    const { data: cfg } = await adm
      .from("comercial_configuracoes")
      .select("ligado")
      .eq("empresa_id", emp)
      .maybeSingle();
    if (!(cfg as { ligado?: boolean } | null)?.ligado)
      throw new Error("A Tatiana ainda não foi liberada pela Nexa nesta empresa.");
    const { error } = await adm
      .from("comercial_configuracoes")
      .update({ modo: data.ligar ? "ativo" : "desligado", updated_at: new Date().toISOString() })
      .eq("empresa_id", emp);
    if (error) throw new Error(error.message);
    return { ligada: data.ligar };
  });

/** Só a Nexa muda o teto do mês (US$). */
export const tatianaTetoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((d: { tetoUsd: number }) => ({ tetoUsd: Number(d?.tetoUsd) }))
  .handler(async ({ context, data }) => {
    if (!(await souNexa(context.supabase as unknown as Db)))
      throw new Error("Só a equipe da Nexa muda o teto da Tatiana.");
    if (!Number.isFinite(data.tetoUsd) || data.tetoUsd < 1 || data.tetoUsd > 1000)
      throw new Error("Teto entre US$ 1 e US$ 1.000.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as unknown as Db)
      .from("comercial_configuracoes")
      .update({
        teto_mensal_usd: Math.round(data.tetoUsd * 100) / 100,
        updated_at: new Date().toISOString(),
      })
      .eq("empresa_id", context.empresaId as string);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
