/**
 * Cliente que foi (ou vai) para a concorrência: aviso URGENTE só no app (vermelho no sininho e no
 * topo do "Precisa de você"), com o valor da concorrência, o valor do nosso orçamento e o link da
 * conversa. Vem da transferência da Alice (motivo "concorrência") ou do toque bloqueado pelo
 * contexto. Um aviso por lead (ou conversa): se já existe e chegou o valor da concorrência, é
 * atualizado e volta como não lido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

/** Motivo da transferência que conta como concorrência. */
export function ehMotivoConcorrencia(motivo: string): boolean {
  return /concorr|outra empresa|mais barat/i.test(motivo);
}

function reais(v: unknown): string | null {
  const n = Number(v);
  return v != null && Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : null;
}

export async function avisarConcorrencia(
  db: Db,
  o: {
    empresaId: string;
    conversaId: string;
    leadId: string | null;
    /** Valor que o cliente disse que a outra empresa cobrou (texto livre, ex.: "R$ 350"). */
    valorConcorrencia?: string | null;
    /** O que o cliente disse (trecho curto). */
    frase?: string | null;
  },
) {
  const referencia = `concorrente:${o.leadId ?? o.conversaId}`;
  const [{ data: lead }, { data: orc }] = await Promise.all([
    o.leadId
      ? db.from("crm_leads").select("lead_name").eq("id", o.leadId).maybeSingle()
      : Promise.resolve({ data: null }),
    o.leadId
      ? db
          .from("quotes")
          .select("total, numero")
          .eq("empresa_id", o.empresaId)
          .eq("crm_lead_id", o.leadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const nosso = reais((orc as { total?: unknown } | null)?.total) ?? "sem orçamento";
  const deles = o.valorConcorrencia?.trim() || "não informado";
  const titulo = `URGENTE: ${(lead as { lead_name?: string } | null)?.lead_name ?? "cliente"} foi para a concorrência`;
  const mensagem = [
    `Concorrência: ${deles} · Nosso orçamento: ${nosso}.`,
    o.frase ? `O cliente disse: "${o.frase.slice(0, 300)}".` : null,
    "Abra a conversa e veja com o gestor uma condição melhor.",
  ]
    .filter(Boolean)
    .join(" ");
  const { data: ja } = await db
    .from("mkt_avisos")
    .select("id")
    .eq("empresa_id", o.empresaId)
    .eq("referencia", referencia)
    .limit(1);
  if (ja?.length) {
    // Sem valor novo, o aviso que já existe fica como está.
    if (!o.valorConcorrencia?.trim()) return;
    await db
      .from("mkt_avisos")
      .update({
        titulo,
        mensagem,
        conversa_id: o.conversaId,
        lido_em: null,
        created_at: new Date().toISOString(),
      })
      .eq("id", ja[0]!.id);
    return;
  }
  await db.from("mkt_avisos").insert({
    empresa_id: o.empresaId,
    tipo: "concorrente",
    titulo,
    mensagem,
    conversa_id: o.conversaId,
    so_no_app: true,
    referencia,
  });
}
