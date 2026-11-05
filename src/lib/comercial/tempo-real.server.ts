/**
 * Tatiana em tempo real (05/11): a cada passada do dia, sem esperar a noite.
 * 1) Concorrência na conversa: mensagem do cliente citando outra empresa ou preço menor →
 *    tarefa P1 "URGENTE: cliente comparando com concorrente" + push (mesmo caminho do aviso da
 *    Alice; um aviso e uma tarefa por lead).
 * 2) Retorno prometido vencido: o cliente disse que responderia hoje (ficha da noite) e, às 15h,
 *    ainda não respondeu → tarefa P1 no mesmo dia (uma vez por promessa).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { travaDoLead } from "@/lib/alice/cadencia";
import { primeiroNomeLimpo } from "@/lib/alice/nome";
import {
  fraseDeConcorrencia,
  mensagemRetornoVencido,
  retornoVencido,
  valorCitado,
} from "./tempo-real";

type Db = SupabaseClient;

export async function concorrenciaNaConversa(
  db: Db,
  empresaId: string,
  agora: Date,
): Promise<number> {
  const desde = new Date(agora.getTime() - 20 * 60_000).toISOString();
  const { data } = await db
    .from("whatsapp_messages")
    .select("conversa_id, text_content, transcricao")
    .eq("empresa_id", empresaId)
    .eq("direction", "Recebida")
    .eq("privada", false)
    .gte("message_timestamp", desde)
    .not("conversa_id", "is", null)
    .limit(500);
  const achadas = new Map<string, string>();
  for (const m of (data ?? []) as Array<{
    conversa_id: string;
    text_content: string | null;
    transcricao: string | null;
  }>) {
    const t = m.text_content || m.transcricao;
    if (fraseDeConcorrencia(t)) achadas.set(m.conversa_id, t as string);
  }
  if (!achadas.size) return 0;
  const { data: convs } = await db
    .from("conversas")
    .select("id, crm_lead_id")
    .in("id", [...achadas.keys()]);
  const { avisarConcorrencia } = await import("@/lib/alice/concorrencia.server");
  let n = 0;
  for (const c of (convs ?? []) as Array<{ id: string; crm_lead_id: string | null }>) {
    if (!c.crm_lead_id) continue;
    const frase = achadas.get(c.id)!;
    await avisarConcorrencia(db, {
      empresaId,
      conversaId: c.id,
      leadId: c.crm_lead_id,
      valorConcorrencia: valorCitado(frase),
      frase,
    });
    n++;
  }
  return n;
}

export async function retornosVencidos(
  db: Db,
  empresaId: string,
  o: { hoje: string; hora: string },
): Promise<number> {
  const { data: fichas } = await db
    .from("comercial_analises")
    .select("id, crm_lead_id, caixinha_em, etiquetas")
    .eq("empresa_id", empresaId)
    .not("etiquetas->>retorno_prometido_em", "is", null)
    .is("etiquetas->>retorno_cobrado_em", null)
    .lte("etiquetas->>retorno_prometido_em", o.hoje)
    .limit(200);
  let n = 0;
  for (const f of (fichas ?? []) as Array<{
    id: string;
    crm_lead_id: string;
    caixinha_em: string | null;
    etiquetas: Record<string, unknown> | null;
  }>) {
    const prometido = String(f.etiquetas?.["retorno_prometido_em"] ?? "");
    // Promessa velha (mais de 3 dias): a noite já cuida; não vira urgência agora.
    if (!prometido || prometido < diaMenos(o.hoje, 3)) continue;
    const { data: resp } = await db
      .from("whatsapp_messages")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", f.crm_lead_id)
      .eq("direction", "Recebida")
      .eq("privada", false)
      .gt("message_timestamp", f.caixinha_em ?? `${prometido}T00:00:00-03:00`)
      .limit(1);
    const vencido = retornoVencido({
      prometidoEm: prometido,
      hoje: o.hoje,
      hora: o.hora,
      respondeuDepois: Boolean(resp?.length),
      jaCobrado: false,
    });
    if (!vencido) continue;
    const { data: lead } = await db
      .from("crm_leads")
      .select(
        "id, lead_name, is_open, perdido_em, os_criada_em, linked_work_order_id, agendado_em, closed_at",
      )
      .eq("id", f.crm_lead_id)
      .maybeSingle();
    const marcar = () =>
      db
        .from("comercial_analises")
        .update({ etiquetas: { ...(f.etiquetas ?? {}), retorno_cobrado_em: o.hoje } })
        .eq("id", f.id);
    if (!lead || travaDoLead(lead as never)) {
      await marcar();
      continue;
    }
    const motivo = `URGENTE: retorno combinado vencido · o cliente disse que responderia em ${prometido.slice(8, 10)}/${prometido.slice(5, 7)} e não respondeu`;
    const { data: aberta } = await db
      .from("crm_followups")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", f.crm_lead_id)
      .eq("origem", "gerente")
      .eq("responsavel", "equipe")
      .eq("status", "Pendente")
      .limit(1)
      .maybeSingle();
    if (aberta) {
      await db
        .from("crm_followups")
        .update({ prioridade: 1, motivo, scheduled_at: new Date().toISOString() })
        .eq("id", (aberta as { id: string }).id);
    } else {
      const { data: conv } = await db
        .from("conversas")
        .select("id")
        .eq("empresa_id", empresaId)
        .eq("crm_lead_id", f.crm_lead_id)
        .order("ultima_atividade_em", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      await db.from("crm_followups").insert({
        empresa_id: empresaId,
        crm_lead_id: f.crm_lead_id,
        conversa_id: (conv as { id: string } | null)?.id ?? null,
        scheduled_at: new Date().toISOString(),
        status: "Pendente",
        responsavel: "equipe",
        trilha: "G",
        etapa: "GR",
        canal: "equipe",
        origem: "gerente",
        tarefa_tipo: "mensagem",
        prioridade: 1,
        mensagem: mensagemRetornoVencido(
          primeiroNomeLimpo((lead as { lead_name: string | null }).lead_name),
        ),
        motivo,
        notes: `Tatiana: ${motivo}`.slice(0, 500),
      });
    }
    await marcar();
    n++;
  }
  return n;
}

function diaMenos(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
