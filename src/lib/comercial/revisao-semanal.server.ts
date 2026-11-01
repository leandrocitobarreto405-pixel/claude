/** Revisão semanal da Tatiana: pede o lote de domingo e lê os avisos ainda não revisados. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DESCRICAO_REVISAO, horaDaRevisao, leadsDaRevisao, rotuloSemana } from "./revisao-semanal";

type Db = SupabaseClient;

/** Avisos da equipe ainda não revisados (até 8 dias), na ordem em que chegaram. */
export async function avisosPendentes(
  db: Db,
  empresaId: string,
): Promise<
  Array<{ id: string; tipo: "erro" | "acerto"; frase: string; crm_lead_id: string | null }>
> {
  const { data } = await db
    .from("comercial_avisos")
    .select("id, tipo, frase, crm_lead_id")
    .eq("empresa_id", empresaId)
    .is("revisado_em", null)
    .gte("criado_em", new Date(Date.now() - 8 * 86_400_000).toISOString())
    .order("criado_em")
    .limit(60);
  return (data ?? []) as Array<{
    id: string;
    tipo: "erro" | "acerto";
    frase: string;
    crm_lead_id: string | null;
  }>;
}

/**
 * Domingo à noite: para cada empresa com a Tatiana ligada (teste ou ativo) e o gerente comercial
 * ligado, pede um lote "Revisão semanal" (uma vez por semana) com os leads da semana atendidos pela
 * Alice e os leads dos avisos. O lote gera as fichas e, no fim, o relatório da semana.
 */
export async function pedirRevisoesSemanais(
  db: Db,
  empresas: string[],
  agora: Date,
  hojeSP: string,
  horaSP: string,
): Promise<Record<string, unknown>> {
  const dia = new Date(`${hojeSP}T12:00:00Z`).getUTCDay();
  if (!horaDaRevisao(dia, horaSP)) return {};
  const descricao = `${DESCRICAO_REVISAO} ${hojeSP}`;
  const saida: Record<string, unknown> = {};
  for (const emp of empresas) {
    const { data: ja } = await db
      .from("comercial_lotes")
      .select("id")
      .eq("empresa_id", emp)
      .eq("descricao", descricao)
      .maybeSingle();
    if (ja) continue;
    const desde = new Date(agora.getTime() - 7 * 86_400_000).toISOString();
    const [avisos, { data: execs }] = await Promise.all([
      avisosPendentes(db, emp),
      db
        .from("ia_execucoes")
        .select("crm_lead_id, created_at")
        .eq("empresa_id", emp)
        .gte("created_at", desde)
        .not("crm_lead_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(3000),
    ]);
    const daSemana = [
      ...new Set(((execs ?? []) as Array<{ crm_lead_id: string }>).map((e) => e.crm_lead_id)),
    ];
    const comAviso = avisos.map((a) => a.crm_lead_id).filter(Boolean) as string[];
    const leads = leadsDaRevisao(comAviso, daSemana);
    if (!leads.length) {
      saida[`revisao_${emp.slice(0, 8)}`] = "sem leads na semana";
      continue;
    }
    const { error } = await db.from("comercial_lotes").insert({
      empresa_id: emp,
      descricao,
      leads,
      gerar_relatorio: true,
      relatorio_periodo: rotuloSemana(hojeSP),
    });
    saida[`revisao_${emp.slice(0, 8)}`] = error ? `erro: ${error.message}` : leads.length;
  }
  return saida;
}
