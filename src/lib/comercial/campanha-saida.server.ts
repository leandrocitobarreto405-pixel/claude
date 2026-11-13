/**
 * Saída das tarefas de venda para a lista de campanha (12/11): lê os sinais do lead, aplica a
 * regra, lista as saídas recentes e deixa a equipe segurar um lead na lista. Sem IA. Nada aqui
 * manda mensagem para cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PREFIXO_CAMPANHA,
  SAIDA_PARA_CAMPANHA_LIGADA,
  diasDoResultado,
  ehTarefaDeVenda,
  tarefaDaTatiana,
  notasDaSegurada,
  resultadoCampanha,
  saiParaCampanha,
  type Saida,
} from "./campanha-saida";

type Db = SupabaseClient;

export type TarefaDaLista = {
  id: string;
  crm_lead_id: string;
  tarefa_tipo: string | null;
  prioridade: number | null;
  notes: string | null;
};

const maior = (...datas: Array<string | null | undefined>): string | null => {
  let m: string | null = null;
  for (const d of datas) if (d && (!m || Date.parse(d) > Date.parse(m))) m = d;
  return m;
};
const diaSP = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

type Ficha = {
  id: string;
  caixinha: number | null;
  rever_em: string | null;
  rever_motivo: string | null;
  etiquetas: Record<string, unknown> | null;
};

/** Lê do banco o que a regra precisa e diz se a tarefa sai. Só leitura. */
export async function avaliarSaida(
  db: Db,
  emp: string,
  t: TarefaDaLista,
  agora = new Date(),
): Promise<{ saida: Saida; ficha: Ficha | null }> {
  const hoje = diaSP(agora);
  const amanhaFim = new Date(Date.parse(`${hoje}T23:59:59-03:00`) + 86_400_000).toISOString();
  const [{ data: ultima }, { data: lead }, { data: orc }, { data: fich }, { data: fus }, acertos] =
    await Promise.all([
      db
        .from("whatsapp_messages")
        .select("message_timestamp")
        .eq("empresa_id", emp)
        .eq("crm_lead_id", t.crm_lead_id)
        .eq("direction", "Recebida")
        .eq("privada", false)
        .order("message_timestamp", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("crm_leads")
        .select("orcamento_enviado_em, linked_work_order_id")
        .eq("empresa_id", emp)
        .eq("id", t.crm_lead_id)
        .maybeSingle(),
      db
        .from("quotes")
        .select("created_at")
        .eq("empresa_id", emp)
        .eq("crm_lead_id", t.crm_lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("comercial_analises")
        .select("id, caixinha, rever_em, rever_motivo, etiquetas")
        .eq("empresa_id", emp)
        .eq("crm_lead_id", t.crm_lead_id)
        .maybeSingle(),
      db
        .from("crm_followups")
        .select("id, trilha, origem, responsavel, scheduled_at")
        .eq("empresa_id", emp)
        .eq("crm_lead_id", t.crm_lead_id)
        .eq("status", "Pendente")
        .limit(20),
      db
        .from("comercial_cobrancas")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", emp)
        .eq("crm_lead_id", t.crm_lead_id)
        .eq("situacao", "pendente"),
    ]);
  const l = lead as { orcamento_enviado_em: string | null; linked_work_order_id: string | null };
  const ficha = (fich ?? null) as Ficha | null;
  const { data: os } = l?.linked_work_order_id
    ? await db
        .from("work_orders")
        .select("status, deleted_at")
        .eq("empresa_id", emp)
        .eq("id", l.linked_work_order_id)
        .maybeSingle()
    : { data: null };
  const w = os as { status: string | null; deleted_at: string | null } | null;
  const etiquetas = (ficha?.etiquetas ?? {}) as {
    retorno_prometido_em?: string | null;
    data_evento?: string | null;
  };
  const pendentes = (fus ?? []) as Array<{
    id: string;
    trilha: string | null;
    origem: string | null;
    responsavel: string | null;
    scheduled_at: string;
  }>;
  // Data combinada no futuro: retorno combinado, data que o cliente deu, "rever em" de data
  // marcada, ou tarefa da equipe agendada para depois de amanhã.
  const dataCombinada =
    pendentes.some((p) => p.trilha === "C") ||
    (etiquetas.retorno_prometido_em ?? "") >= hoje ||
    (etiquetas.data_evento ?? "") >= hoje ||
    ficha?.caixinha === 3 ||
    (ficha?.rever_motivo === "véspera da data combinada" &&
      Boolean(ficha.rever_em && Date.parse(ficha.rever_em) > agora.getTime())) ||
    pendentes.some(
      (p) => p.id !== t.id && p.responsavel === "equipe" && p.scheduled_at > amanhaFim,
    );
  const saida = saiParaCampanha(
    {
      tipo: t.tarefa_tipo,
      prioridade: t.prioridade,
      notas: t.notes,
      ultimaDoCliente: (ultima as { message_timestamp?: string } | null)?.message_timestamp ?? null,
      orcamentoEm: maior(
        l?.orcamento_enviado_em,
        (orc as { created_at?: string } | null)?.created_at,
      ),
      dataCombinada,
      osAberta: Boolean(
        w && !w.deleted_at && w.status !== "Concluída" && !/cancel/i.test(w.status ?? ""),
      ),
      acertoPendente: (acertos.count ?? 0) > 0,
    },
    { agora, hoje },
  );
  return { saida, ficha };
}

/**
 * Tira a tarefa da lista e guarda o lead para a campanha (volta para a leitura quando o cliente
 * mandar mensagem). Devolve true quando saiu. Com a saída desligada, nunca tira nada.
 */
export async function mandarParaCampanha(
  db: Db,
  emp: string,
  t: TarefaDaLista,
  agora = new Date(),
): Promise<boolean> {
  if (!SAIDA_PARA_CAMPANHA_LIGADA) return false;
  // Antes de consultar o banco: o que já se sabe pela própria tarefa.
  if (!ehTarefaDeVenda(t.tarefa_tipo) || t.prioridade === 1 || !tarefaDaTatiana(t)) return false;
  const { saida, ficha } = await avaliarSaida(db, emp, t, agora);
  // Sem ficha não há onde guardar o lead: a tarefa continua na lista.
  if (!saida.sai || !ficha) return false;
  const quando = agora.toISOString();
  const { error } = await db
    .from("comercial_analises")
    .update({ etiquetas: { ...(ficha.etiquetas ?? {}), guardado_em: quando } })
    .eq("id", ficha.id);
  if (error) return false;
  const { error: erro } = await db
    .from("crm_followups")
    .update({ status: "Cancelada", completed_at: quando, result: resultadoCampanha(saida.dias) })
    .eq("id", t.id)
    .eq("status", "Pendente");
  return !erro;
}

export type SaidaRecente = {
  id: string;
  leadId: string;
  leadNome: string;
  telefoneFinal: string;
  dias: number | null;
  saiuEm: string;
};

/** Tarefas que saíram para a campanha desde `desde` (para a equipe poder segurar). */
export async function saidasRecentes(db: Db, emp: string, desde: string): Promise<SaidaRecente[]> {
  const { data } = await db
    .from("crm_followups")
    .select("id, crm_lead_id, result, completed_at")
    .eq("empresa_id", emp)
    .eq("origem", "gerente")
    .eq("status", "Cancelada")
    .like("result", `${PREFIXO_CAMPANHA}%`)
    .gte("completed_at", desde)
    .order("completed_at", { ascending: false })
    .limit(100);
  const linhas = (data ?? []) as Array<{
    id: string;
    crm_lead_id: string;
    result: string | null;
    completed_at: string;
  }>;
  if (!linhas.length) return [];
  const { data: leads } = await db
    .from("crm_leads")
    .select("id, lead_name, normalized_phone")
    .eq("empresa_id", emp)
    .in("id", [...new Set(linhas.map((x) => x.crm_lead_id))]);
  const lead = new Map(
    (
      (leads ?? []) as Array<{
        id: string;
        lead_name: string | null;
        normalized_phone: string | null;
      }>
    ).map((x) => [x.id, x]),
  );
  const vistos = new Set<string>();
  return linhas
    .filter((x) => (vistos.has(x.crm_lead_id) ? false : (vistos.add(x.crm_lead_id), true)))
    .map((x) => ({
      id: x.id,
      leadId: x.crm_lead_id,
      leadNome: (lead.get(x.crm_lead_id)?.lead_name ?? "").trim() || "Cliente sem nome",
      telefoneFinal: (lead.get(x.crm_lead_id)?.normalized_phone ?? "").replace(/\D/g, "").slice(-4),
      dias: diasDoResultado(x.result),
      saiuEm: x.completed_at,
    }));
}

/**
 * A equipe segura o lead na lista: a tarefa volta a ficar pendente para hoje, com a marca que a
 * impede de sair de novo por 7 dias, e o lead deixa de estar guardado para campanha.
 */
export async function segurarNaLista(
  db: Db,
  emp: string,
  tarefaId: string,
  agora = new Date(),
): Promise<boolean> {
  const { data: t } = await db
    .from("crm_followups")
    .select("id, crm_lead_id, notes, result, status")
    .eq("empresa_id", emp)
    .eq("id", tarefaId)
    .eq("origem", "gerente")
    .maybeSingle();
  const tarefa = t as {
    id: string;
    crm_lead_id: string;
    notes: string | null;
    result: string | null;
    status: string;
  } | null;
  if (
    !tarefa ||
    tarefa.status !== "Cancelada" ||
    !(tarefa.result ?? "").startsWith(PREFIXO_CAMPANHA)
  )
    return false;
  const { data: f } = await db
    .from("comercial_analises")
    .select("id, etiquetas")
    .eq("empresa_id", emp)
    .eq("crm_lead_id", tarefa.crm_lead_id)
    .maybeSingle();
  const ficha = f as { id: string; etiquetas: Record<string, unknown> | null } | null;
  if (ficha) {
    const { guardado_em: _fora, ...resto } = ficha.etiquetas ?? {};
    await db.from("comercial_analises").update({ etiquetas: resto }).eq("id", ficha.id);
  }
  const { error } = await db
    .from("crm_followups")
    .update({
      status: "Pendente",
      result: null,
      completed_at: null,
      scheduled_at: agora.toISOString(),
      notes: notasDaSegurada(tarefa.notes, diaSP(agora)),
    })
    .eq("id", tarefa.id)
    .eq("status", "Cancelada");
  return !error;
}
