/**
 * "Voltar na conversa" (05/11): quando a equipe entra no meio da sequência (achou caro, comparando,
 * dúvida, negociação), a sequência da Alice para naquela conversa. Toda noite a Tatiana cria para
 * a manhã seguinte a tarefa "Voltar na conversa", com contexto e mensagem pronta, até o lead ter
 * desfecho (encerrado, perdido, agendado ou com OS). Uma tarefa aberta por lead: se a de ontem não
 * foi feita, ela continua (pendente de ontem) e não sai outra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { primeiraAtendente, rotuloDoToque, travaDoLead } from "@/lib/alice/cadencia";
import { primeiroNomeLimpo } from "@/lib/alice/nome";
import { prioridadeVoltarConversa } from "./voltar-conversa";

type Db = SupabaseClient;

/** Motivos da trava do toque que querem dizer "a equipe entrou no meio". */
export const EQUIPE_ENTROU = ["equipe escreveu para o cliente", "equipe assumiu a conversa"];

export async function tarefasVoltarConversa(
  db: Db,
  o: { emp: string; quando: string; agora: Date },
): Promise<{ criadas: number; custo: number }> {
  const desde = new Date(o.agora.getTime() - 30 * 86_400_000).toISOString();
  const { data: paradas } = await db
    .from("crm_followups")
    .select("crm_lead_id, conversa_id, completed_at")
    .eq("empresa_id", o.emp)
    .eq("status", "Cancelada")
    .eq("trilha", "A")
    .in("result", EQUIPE_ENTROU)
    .gte("completed_at", desde)
    .order("completed_at", { ascending: false })
    .limit(300);
  const porLead = new Map<string, string>();
  for (const p of (paradas ?? []) as Array<{
    crm_lead_id: string | null;
    conversa_id: string | null;
  }>)
    if (p.crm_lead_id && p.conversa_id && !porLead.has(p.crm_lead_id))
      porLead.set(p.crm_lead_id, p.conversa_id);
  if (!porLead.size) return { criadas: 0, custo: 0 };

  const ids = [...porLead.keys()];
  const [{ data: leads }, { data: abertas }, { data: cfg }, { data: emp }] = await Promise.all([
    db
      .from("crm_leads")
      .select(
        "id, lead_name, is_open, perdido_em, os_criada_em, linked_work_order_id, agendado_em, closed_at",
      )
      .eq("empresa_id", o.emp)
      .in("id", ids),
    db
      .from("crm_followups")
      .select("crm_lead_id")
      .eq("empresa_id", o.emp)
      .eq("status", "Pendente")
      .in("crm_lead_id", ids),
    db.from("ia_configuracoes").select("nomes_atendentes").eq("empresa_id", o.emp).maybeSingle(),
    db.from("empresas").select("nome").eq("id", o.emp).maybeSingle(),
  ]);
  const comTarefa = new Set(
    ((abertas ?? []) as Array<{ crm_lead_id: string }>).map((a) => a.crm_lead_id),
  );
  const atendente = primeiraAtendente(
    (cfg as { nomes_atendentes?: string | null } | null)?.nomes_atendentes,
  );
  const rotulo = rotuloDoToque("VC", { atendente }) ?? "Voltar na conversa";
  const empresa = (emp as { nome?: string } | null)?.nome ?? "empresa";
  const { mensagemDoToqueEquipe } = await import("@/lib/alice/toque-equipe.server");

  let criadas = 0;
  let custo = 0;
  for (const l of (leads ?? []) as Array<{
    id: string;
    lead_name: string | null;
    is_open: boolean | null;
    perdido_em: string | null;
    os_criada_em: string | null;
    linked_work_order_id: string | null;
    agendado_em: string | null;
    closed_at: string | null;
  }>) {
    // Sem limite por noite (05/11): toda conversa parada no meio vira tarefa, com prioridade.
    if (travaDoLead(l) || comTarefa.has(l.id)) continue;
    const conversaId = porLead.get(l.id)!;
    const { data: ultimas } = await db
      .from("whatsapp_messages")
      .select("text_content, transcricao")
      .eq("empresa_id", o.emp)
      .eq("conversa_id", conversaId)
      .eq("privada", false)
      .order("message_timestamp", { ascending: false })
      .limit(15);
    const prioridade = prioridadeVoltarConversa(
      ((ultimas ?? []) as Array<{ text_content: string | null; transcricao: string | null }>).map(
        (m) => m.text_content || m.transcricao,
      ),
    );
    const escrita = await mensagemDoToqueEquipe(db, {
      etapa: "VC",
      nomeCliente: primeiroNomeLimpo(l.lead_name),
      atendente,
      empresa,
      empresaId: o.emp,
      conversaId,
    });
    custo += escrita.custo;
    const { error } = await db.from("crm_followups").insert({
      empresa_id: o.emp,
      crm_lead_id: l.id,
      conversa_id: conversaId,
      scheduled_at: o.quando,
      status: "Pendente",
      responsavel: "equipe",
      trilha: "G",
      etapa: "VC",
      canal: "equipe",
      origem: "gerente",
      tarefa_tipo: "mensagem",
      prioridade,
      mensagem: escrita.mensagem.slice(0, 1000),
      motivo:
        prioridade === 1
          ? "Negociação de preço em andamento (a equipe entrou na conversa): retomar hoje de manhã, até ter desfecho."
          : "A equipe entrou na conversa e a sequência da Alice parou: seguir com o cliente até ter desfecho.",
      notes: `Tatiana: ${rotulo} (todo dia até o desfecho).`,
    });
    if (!error) criadas++;
  }
  return { criadas, custo };
}
