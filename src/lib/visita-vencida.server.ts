import {
  desdeQuando,
  jaTemTarefa,
  lerMarcaVencida,
  marcaVencida,
  motivoParaFechar,
  SITUACOES_ABERTAS,
  somarDias,
  textoVisitaVencida,
  visitaVencida,
  type OsParaVencer,
} from "@/lib/visita-vencida";

/**
 * Visita vencida vira tarefa P1 "remarcar" (11/11, pedido do dono). Roda na varredura do servidor,
 * a partir das 8h, em todas as empresas e sem depender da Tatiana estar ligada nem do teto dela.
 * Uma tarefa por visita e data: a marca [vencida:<visita>:<dia>] nas notas evita repetir. A tarefa
 * fecha sozinha quando a visita é concluída, cancelada ou remarcada. Nada vai ao cliente por aqui.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const HORA_INICIO = "08:00";

type Visita = {
  id: string;
  empresa_id: string;
  work_order_id: string;
  scheduled_date: string;
  status: string;
  retirada: string | null;
  work_order:
    | (NonNullable<OsParaVencer> & {
        os_number: string | number | null;
        customer: { full_name: string | null } | null;
      })
    | null;
};

const SELECT =
  "id, empresa_id, work_order_id, scheduled_date, status, retirada, work_order:work_order_id ( os_number, status, deleted_at, eh_teste, customer:customer_id ( full_name ) )";

function agoraSP() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
}

function primeiroNome(nome: string | null | undefined): string {
  const p = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

export async function rodarVisitasVencidas(
  agora = agoraSP(),
): Promise<{ criadas: number; fechadas: number; semLead: number }> {
  const saida = { criadas: 0, fechadas: 0, semLead: 0 };
  if (agora.hora < HORA_INICIO) return saida;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;

  saida.fechadas = await fecharResolvidas(db);

  const { data: visitas, error } = await db
    .from("visits")
    .select(SELECT)
    .is("retirada", null)
    .in("status", [...SITUACOES_ABERTAS])
    .gte("scheduled_date", desdeQuando(agora.data))
    .lt("scheduled_date", agora.data)
    .order("scheduled_date")
    .limit(200);
  if (error) throw new Error(`visitas vencidas: ${error.message}`);

  const horariosDe = new Map<string, [string, string] | null>();
  const horarios = async (empresaId: string) => {
    if (!horariosDe.has(empresaId)) {
      const { horariosParaModelo } = await import("@/lib/alice/cadencia.server");
      horariosDe.set(empresaId, await horariosParaModelo(db, empresaId));
    }
    return horariosDe.get(empresaId) ?? null;
  };

  for (const v of (visitas ?? []) as Visita[]) {
    if (!visitaVencida(v, v.work_order, agora.data)) continue;
    const marca = marcaVencida(v.id, v.scheduled_date);
    const { data: ja } = await db
      .from("crm_followups")
      .select("status, result")
      .eq("empresa_id", v.empresa_id)
      .like("notes", `%${marca}%`)
      .limit(5);
    if (jaTemTarefa((ja ?? []) as Array<{ status: string; result: string | null }>)) continue;
    const osNumero = v.work_order?.os_number == null ? null : String(v.work_order.os_number);
    const { data: lead } = await db
      .from("crm_leads")
      .select("id")
      .eq("empresa_id", v.empresa_id)
      .eq("linked_work_order_id", v.work_order_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const leadId = (lead as { id: string } | null)?.id ?? null;
    if (!leadId) {
      if (await avisarSemLead(db, v, osNumero)) saida.semLead++;
      continue;
    }
    const { data: conversa } = await db
      .from("conversas")
      .select("id")
      .eq("empresa_id", v.empresa_id)
      .eq("crm_lead_id", leadId)
      .order("ultima_atividade_em", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const t = textoVisitaVencida({
      nome: primeiroNome(v.work_order?.customer?.full_name),
      osNumero,
      dia: v.scheduled_date,
      horarios: await horarios(v.empresa_id),
    });
    const { error: erro } = await db.from("crm_followups").insert({
      empresa_id: v.empresa_id,
      crm_lead_id: leadId,
      conversa_id: (conversa as { id: string } | null)?.id ?? null,
      scheduled_at: new Date().toISOString(),
      status: "Pendente",
      origem: "gerente",
      responsavel: "equipe",
      trilha: "G",
      etapa: "G1",
      canal: "equipe",
      prioridade: 1,
      tarefa_tipo: "remarcar",
      motivo: t.motivo.slice(0, 300),
      mensagem: t.mensagem.slice(0, 1000),
      notes: `Tatiana: visita vencida sem conclusão nem nova data ${marca}`.slice(0, 500),
    });
    if (erro) {
      console.error("Visita vencida: falha ao criar a tarefa", v.id, erro.message);
      continue;
    }
    saida.criadas++;
    // A ficha da Tatiana espera a remarcação (não cria outra tarefa por cima nesta noite).
    await db
      .from("comercial_analises")
      .update({
        caixinha: 2,
        caixinha_em: new Date().toISOString(),
        rever_em: new Date(`${somarDias(agora.data, 2)}T00:00:00-03:00`).toISOString(),
        rever_motivo: "ver se remarcou",
      })
      .eq("empresa_id", v.empresa_id)
      .eq("crm_lead_id", leadId);
  }
  return saida;
}

/** Fecha sozinha a tarefa cuja visita foi concluída, cancelada ou remarcada. */
async function fecharResolvidas(db: Db): Promise<number> {
  const { data: abertas } = await db
    .from("crm_followups")
    .select("id, notes")
    .eq("status", "Pendente")
    .eq("tarefa_tipo", "remarcar")
    .like("notes", "%[vencida:%")
    .limit(200);
  const tarefas = ((abertas ?? []) as Array<{ id: string; notes: string | null }>)
    .map((t) => ({ id: t.id, marca: lerMarcaVencida(t.notes) }))
    .filter((t): t is { id: string; marca: { visitaId: string; dia: string } } => Boolean(t.marca));
  if (!tarefas.length) return 0;
  const { data: vs } = await db
    .from("visits")
    .select(SELECT)
    .in("id", [...new Set(tarefas.map((t) => t.marca.visitaId))]);
  const porId = new Map(((vs ?? []) as Visita[]).map((v) => [v.id, v]));
  let fechadas = 0;
  for (const t of tarefas) {
    const v = porId.get(t.marca.visitaId) ?? null;
    const motivo = motivoParaFechar(v ? { ...v, os: v.work_order } : null, t.marca.dia);
    if (!motivo) continue;
    const { error } = await db
      .from("crm_followups")
      .update({
        status: "Cancelada",
        completed_at: new Date().toISOString(),
        result: `fechada sozinha: ${motivo}`,
      })
      .eq("id", t.id)
      .eq("status", "Pendente");
    if (!error) fechadas++;
  }
  return fechadas;
}

/** OS sem lead no CRM: aviso só no app (o mesmo "Serviço ainda não concluído"), uma vez por visita. */
async function avisarSemLead(db: Db, v: Visita, osNumero: string | null): Promise<boolean> {
  const referencia = `visita:${v.id}`;
  const { data: ja } = await db
    .from("mkt_avisos")
    .select("id")
    .eq("empresa_id", v.empresa_id)
    .eq("tipo", "servico_nao_concluido")
    .eq("referencia", referencia)
    .limit(1);
  if (ja?.length) return false;
  const dia = `${v.scheduled_date.slice(8, 10)}/${v.scheduled_date.slice(5, 7)}`;
  const { error } = await db.from("mkt_avisos").insert({
    empresa_id: v.empresa_id,
    tipo: "servico_nao_concluido",
    titulo: "Serviço ainda não concluído",
    mensagem: `Serviço de ${dia}${osNumero ? ` da OS ${osNumero}` : ""} ainda não foi concluído nem remarcado. A OS não tem lead no CRM para virar tarefa: conclua ou remarque pela agenda.`,
    so_no_app: true,
    referencia,
  });
  return !error;
}
