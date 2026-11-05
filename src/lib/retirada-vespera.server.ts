import { osElegivel } from "@/lib/alice/pos-atendimento";
import {
  datasDaVespera,
  itensDaConfirmacao,
  mensagemDaVespera,
  quandoDaVespera,
  type TipoRetirada,
} from "@/lib/retirada";

/**
 * Confirmação da retirada e da entrega de persiana/tapete na véspera (05/11, aprovado pelo dono).
 * Enquanto a Meta não aprova tc_confirmacao_retirada / tc_confirmacao_entrega, vira tarefa da
 * equipe (P2, mensagem pronta) a partir das 10h. Nada é enviado ao cliente por aqui.
 * Uma tarefa por atendimento e etapa: a marca [retirada:<visita>:<dia>] nas notas evita repetir.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const HORA_TAREFA = "10:00";
const ETAPA = { Retirada: "RT", Entrega: "EN" } as const;

type VisitaRetirada = {
  id: string;
  empresa_id: string;
  work_order_id: string;
  scheduled_date: string;
  entrega_prevista: string | null;
  entrega_feita_em: string | null;
  retirada: TipoRetirada;
  status: string;
  work_order: {
    os_number: string | number | null;
    status: string | null;
    deleted_at: string | null;
    eh_teste: boolean | null;
    customer: { full_name: string | null } | null;
  } | null;
};

const SELECT =
  "id, empresa_id, work_order_id, scheduled_date, entrega_prevista, entrega_feita_em, retirada, status, work_order:work_order_id ( os_number, status, deleted_at, eh_teste, customer:customer_id ( full_name ) )";

function agoraSP() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
}

// OS excluída, cancelada ou de teste não vira tarefa (mesma regra da confirmação do serviço).
const osAtiva = (v: VisitaRetirada) => osElegivel(v.work_order);

function primeiroNome(nome: string | null | undefined): string {
  const p = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

/** Peças do atendimento: unidade conta a quantidade; m² conta cada linha como uma peça. */
async function pecas(db: Db, visitId: string): Promise<number> {
  const { data } = await db
    .from("service_items")
    .select("quantity, unidade, active")
    .eq("visit_id", visitId);
  return ((data ?? []) as Array<{ quantity: number; unidade: string | null; active: boolean }>)
    .filter((i) => i.active !== false)
    .reduce((s, i) => s + (i.unidade === "m2" ? 1 : Number(i.quantity) || 1), 0);
}

export async function rodarVesperaRetirada(): Promise<{ criadas: number; semLead: number }> {
  const agora = agoraSP();
  if (agora.hora < HORA_TAREFA) return { criadas: 0, semLead: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;
  const datas = datasDaVespera(agora.data);

  const [{ data: retiradas }, { data: entregas }] = await Promise.all([
    db
      .from("visits")
      .select(SELECT)
      .not("retirada", "is", null)
      .in("scheduled_date", datas)
      .in("status", ["Agendado", "Reagendado", "Confirmado"]),
    db
      .from("visits")
      .select(SELECT)
      .not("retirada", "is", null)
      .in("entrega_prevista", datas)
      .is("entrega_feita_em", null)
      .neq("status", "Cancelado"),
  ]);
  const itens: Array<{ v: VisitaRetirada; etapa: "Retirada" | "Entrega"; dia: string }> = [
    ...((retiradas ?? []) as VisitaRetirada[]).map((v) => ({
      v,
      etapa: "Retirada" as const,
      dia: v.scheduled_date,
    })),
    ...((entregas ?? []) as VisitaRetirada[]).map((v) => ({
      v,
      etapa: "Entrega" as const,
      dia: v.entrega_prevista!,
    })),
  ].filter((x) => osAtiva(x.v));

  let criadas = 0;
  let semLead = 0;
  for (const { v, etapa, dia } of itens) {
    const marca = `[${etapa === "Retirada" ? "retirada" : "entrega"}:${v.id}:${dia}]`;
    const { data: ja } = await db
      .from("crm_followups")
      .select("id")
      .eq("empresa_id", v.empresa_id)
      .like("notes", `%${marca}%`)
      .limit(1);
    if (ja?.length) continue;
    const osNumero = v.work_order?.os_number == null ? "?" : String(v.work_order.os_number);
    const { data: lead } = await db
      .from("crm_leads")
      .select("id")
      .eq("empresa_id", v.empresa_id)
      .eq("linked_work_order_id", v.work_order_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const leadId = (lead as { id: string } | null)?.id ?? null;
    const titulo = `Confirmar ${etapa.toLowerCase()} de ${v.retirada} (OS ${osNumero})`;
    if (!leadId) {
      semLead++;
      await avisarSemLead(db, v.empresa_id, titulo, dia, marca);
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
    const quando = quandoDaVespera(dia, agora.data);
    const mensagem = mensagemDaVespera(
      etapa,
      primeiroNome(v.work_order?.customer?.full_name),
      itensDaConfirmacao(v.retirada, await pecas(db, v.id)),
      quando,
    );
    const { error } = await db.from("crm_followups").insert({
      empresa_id: v.empresa_id,
      crm_lead_id: leadId,
      conversa_id: (conversa as { id: string } | null)?.id ?? null,
      scheduled_at: new Date().toISOString(),
      status: "Pendente",
      origem: "gerente",
      responsavel: "equipe",
      trilha: "G",
      etapa: ETAPA[etapa],
      canal: "equipe",
      prioridade: 2,
      tarefa_tipo: "mensagem",
      motivo: `${titulo}: ${quando}, horário comercial (8h às 18h).`.slice(0, 300),
      mensagem: mensagem.slice(0, 1000),
      notes: `Tatiana: ${titulo}. Modelo da Meta ainda não aprovado ${marca}`.slice(0, 500),
    });
    if (!error) criadas++;
    else console.error("Retirada: falha ao criar a tarefa da véspera", v.id, error.message);
  }
  return { criadas, semLead };
}

/** OS sem lead no CRM: aviso só no app, uma vez por atendimento e dia. */
async function avisarSemLead(
  db: Db,
  empresaId: string,
  titulo: string,
  dia: string,
  marca: string,
): Promise<void> {
  const { data: ja } = await db
    .from("mkt_avisos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("referencia", marca)
    .limit(1);
  if (ja?.length) return;
  await db.from("mkt_avisos").insert({
    empresa_id: empresaId,
    tipo: "gerente_retirada",
    titulo,
    mensagem: `${titulo} em ${dia.slice(8, 10)}/${dia.slice(5, 7)}: a OS não tem lead no CRM para virar tarefa. Confirme com o cliente pela conversa.`,
    so_no_app: true,
    referencia: marca,
  });
}
