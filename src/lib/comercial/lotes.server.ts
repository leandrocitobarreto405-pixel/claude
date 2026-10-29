/**
 * Gerente comercial: lotes de análise retomáveis. Um lote é um pedido gravado em comercial_lotes
 * (lista de leads); a varredura do servidor (a cada 5–10 min) pega o lote mais antigo e analisa
 * alguns leads por vez, até terminar. Para antes de passar do teto em US$ da empresa (gasto de
 * todas as análises e relatórios). Só roda em empresa com o gerente comercial ligado.
 */
import { analisarLead, contextoDaEmpresa } from "./analise.server";

/** Leads analisados por passada (em paralelo) e tempo máximo da passada. */
const POR_PASSADA = 3;
/** Margem de segurança: não começa um lead se o gasto + isto passar do teto. */
const CUSTO_MAXIMO_POR_LEAD = 0.25;
/** Outra passada só assume o lote se a anterior parou de atualizar há mais que isto. */
const TRAVA_MS = 4 * 60_000;

type Lote = {
  id: string;
  empresa_id: string;
  leads: string[];
  status: string;
  processados: number;
  com_erro: number;
  custo_usd: number;
  iniciado_em: string | null;
};

export async function gastoDaEmpresa(
  db: import("@supabase/supabase-js").SupabaseClient,
  empresaId: string,
): Promise<number> {
  const [{ data: a }, { data: r }] = await Promise.all([
    db.from("comercial_analises").select("custo_usd").eq("empresa_id", empresaId),
    db.from("comercial_relatorios").select("custo_usd").eq("empresa_id", empresaId),
  ]);
  const soma = (xs: Array<{ custo_usd: number | string | null }> | null) =>
    (xs ?? []).reduce((s, x) => s + Number(x.custo_usd ?? 0), 0);
  return soma(a as never) + soma(r as never);
}

export async function rodarLotesComerciais(): Promise<Record<string, unknown> | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
  const agora = new Date();
  const { data: lotes } = await db
    .from("comercial_lotes")
    .select(
      "id, empresa_id, leads, status, processados, com_erro, custo_usd, iniciado_em, atualizado_em",
    )
    .in("status", ["pendente", "rodando"])
    .order("pedido_em")
    .limit(1);
  const candidato = (lotes ?? [])[0] as (Lote & { atualizado_em: string | null }) | undefined;
  if (!candidato) return null;
  // Assume o lote (uma passada por vez).
  const limite = new Date(agora.getTime() - TRAVA_MS).toISOString();
  const { data: assumido } = await db
    .from("comercial_lotes")
    .update({
      status: "rodando",
      atualizado_em: agora.toISOString(),
      iniciado_em: candidato.iniciado_em ?? agora.toISOString(),
    })
    .eq("id", candidato.id)
    .or(`atualizado_em.is.null,atualizado_em.lt.${limite}`)
    .select("id")
    .maybeSingle();
  if (!assumido) return { lote: candidato.id, situacao: "outra passada em andamento" };
  const lote = candidato;

  const { data: cfg } = await db
    .from("comercial_configuracoes")
    .select("ligado, teto_usd")
    .eq("empresa_id", lote.empresa_id)
    .maybeSingle();
  const config = cfg as { ligado: boolean; teto_usd: number | string } | null;
  if (!config?.ligado) {
    await db
      .from("comercial_lotes")
      .update({
        status: "cancelado",
        erro: "gerente comercial desligado nesta empresa",
        concluido_em: agora.toISOString(),
      })
      .eq("id", lote.id);
    return { lote: lote.id, situacao: "desligado" };
  }
  const teto = Number(config.teto_usd);

  // Leads do lote que ainda não têm ficha deste lote.
  const { data: feitos } = await db
    .from("comercial_analises")
    .select("crm_lead_id, status")
    .eq("empresa_id", lote.empresa_id)
    .eq("lote_id", lote.id)
    .in("crm_lead_id", lote.leads);
  const jaFeitos = new Set(
    ((feitos ?? []) as Array<{ crm_lead_id: string }>).map((f) => f.crm_lead_id),
  );
  const faltam = lote.leads.filter((id) => !jaFeitos.has(id));
  if (!faltam.length) {
    await db
      .from("comercial_lotes")
      .update({
        status: "concluido",
        concluido_em: agora.toISOString(),
        atualizado_em: agora.toISOString(),
      })
      .eq("id", lote.id);
    return { lote: lote.id, situacao: "concluido" };
  }

  const gasto = await gastoDaEmpresa(db, lote.empresa_id);
  const cabem = Math.max(0, Math.floor((teto - gasto) / CUSTO_MAXIMO_POR_LEAD));
  if (cabem === 0) {
    await db
      .from("comercial_lotes")
      .update({
        status: "parado_teto",
        erro: `gasto US$ ${gasto.toFixed(2)} perto do teto de US$ ${teto.toFixed(2)}`,
        atualizado_em: agora.toISOString(),
      })
      .eq("id", lote.id);
    return { lote: lote.id, situacao: "parado no teto", gasto };
  }

  const contexto = await contextoDaEmpresa(db, lote.empresa_id);
  const agoraLeads = faltam.slice(0, Math.min(POR_PASSADA, cabem));
  const resultados = await Promise.all(
    agoraLeads.map((leadId) =>
      analisarLead(db, { empresaId: lote.empresa_id, leadId, loteId: lote.id, contexto }),
    ),
  );
  const custo = resultados.reduce((s, r) => s + r.custoUsd, 0);
  const erros = resultados.filter((r) => !r.ok).length;
  const restam = faltam.length - agoraLeads.length;
  const fim = new Date().toISOString();
  await db
    .from("comercial_lotes")
    .update({
      processados: lote.processados + agoraLeads.length,
      com_erro: lote.com_erro + erros,
      custo_usd: Number(lote.custo_usd) + custo,
      atualizado_em: restam ? new Date(0).toISOString() : fim,
      ...(restam ? {} : { status: "concluido", concluido_em: fim }),
    })
    .eq("id", lote.id);
  return {
    lote: lote.id,
    analisados: agoraLeads.length,
    erros,
    custo: Math.round(custo * 10000) / 10000,
    transcritos: resultados.reduce((s, r) => s + r.transcritos, 0),
    restam,
  };
}
