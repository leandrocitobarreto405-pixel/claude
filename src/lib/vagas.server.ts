/**
 * Alarme de vaga na agenda, lado do servidor (11/11): lê as vagas abertas pela regra de ocupação
 * que já existe, monta a lista de quem chamar (na ordem pedida pelo dono) e manda os pushes das
 * 8h30, 10h30, 13h30 e 16h enquanto houver vaga. Tudo calculado na hora: quando a vaga é
 * preenchida, some da faixa, da lista e dos pushes. Nada aqui manda mensagem para cliente.
 */
import {
  HORAS_DO_PUSH,
  ordenarCandidatos,
  pushDaHora,
  somarDias,
  textoDoPush,
  vagasAbertas,
  type CandidatoDaVaga,
  type Vaga,
} from "@/lib/vagas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function agoraSP() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
}

export type VagasDaEmpresa = {
  /** Há horário base de técnico próprio? Sem isso não há alarme. */
  configurado: boolean;
  hoje: string;
  vagas: Vaga[];
};

/** Vagas abertas agora na empresa (hoje com 3 h de folga e os 2 próximos dias de atendimento). */
export async function lerVagas(
  db: Db,
  empresaId: string,
  agora = agoraSP(),
): Promise<VagasDaEmpresa> {
  const { carregarAgenda } = await import("@/lib/alice/agendamento.server");
  const agenda = await carregarAgenda(
    { admin: db, empresaId } as never,
    agora.data,
    somarDias(agora.data, 10),
  );
  if ("erro" in agenda) throw new Error(`vagas: ${agenda.erro}`);
  if (!agenda.horarios.length) return { configurado: false, hoje: agora.data, vagas: [] };
  return {
    configurado: true,
    hoje: agora.data,
    vagas: vagasAbertas({
      agora,
      base: agenda.horarios,
      ocupacoes: agenda.ocupacoes,
      regras: agenda.regras,
      bloqueados: agenda.bloqueados,
    }),
  };
}

const SITUACOES_ABERTAS = ["Agendado", "Confirmado", "Reagendado"];
const iso = (d: string) => new Date(`${d}T00:00:00-03:00`).toISOString();
const dataCurta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const reais = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type VisitaLinha = {
  id: string;
  work_order_id: string;
  scheduled_date: string;
  status: string;
  updated_at: string;
  work_order: {
    os_number: string | number | null;
    status: string | null;
    deleted_at: string | null;
    eh_teste: boolean | null;
    customer_id: string | null;
    customer: { full_name: string | null } | null;
  } | null;
  service_items: Array<{ description: string | null; active: boolean | null }> | null;
};

const SELECT_VISITA =
  "id, work_order_id, scheduled_date, status, updated_at, work_order:work_order_id ( os_number, status, deleted_at, eh_teste, customer_id, customer:customer_id ( full_name ) ), service_items ( description, active )";

const osVale = (v: VisitaLinha) =>
  Boolean(v.work_order) && !v.work_order!.deleted_at && !v.work_order!.eh_teste;
const estofadoDe = (v: VisitaLinha) =>
  (v.service_items ?? []).find((i) => i.active !== false && i.description)?.description ?? null;

/**
 * Quem chamar para preencher as vagas, na ordem: (a) serviço cancelado ou esperando remarcar,
 * (b) em negociação ou pediu um tempo, (c) serviço marcado mais adiante, (d) orçamento recente sem
 * resposta dentro da área. Cada pessoa aparece uma vez.
 */
export async function candidatosDasVagas(
  db: Db,
  empresaId: string,
  hoje: string,
  ultimoDiaComVaga: string,
): Promise<CandidatoDaVaga[]> {
  const ha14 = somarDias(hoje, -14);
  const [vencidas, canceladas, adiante, fichas, orcamentos] = await Promise.all([
    // (a) passou da data sem conclusão nem nova data.
    db
      .from("visits")
      .select(SELECT_VISITA)
      .eq("empresa_id", empresaId)
      .is("retirada", null)
      .in("status", [...SITUACOES_ABERTAS, "Em deslocamento", "Em execução"])
      .gte("scheduled_date", ha14)
      .lt("scheduled_date", hoje)
      .limit(60),
    // (a) visita cancelada nos últimos 14 dias.
    db
      .from("visits")
      .select(SELECT_VISITA)
      .eq("empresa_id", empresaId)
      .eq("status", "Cancelado")
      .gte("updated_at", iso(ha14))
      .limit(60),
    // (c) serviço marcado depois das vagas (até 30 dias): pode querer adiantar.
    db
      .from("visits")
      .select(SELECT_VISITA)
      .eq("empresa_id", empresaId)
      .is("retirada", null)
      .in("status", SITUACOES_ABERTAS)
      .gt("scheduled_date", ultimoDiaComVaga)
      .lte("scheduled_date", somarDias(hoje, 30))
      .order("scheduled_date")
      .limit(60),
    // (b) fichas da Tatiana: em negociação (2) ou retorno com data (3), mexidas nos últimos 21 dias.
    db
      .from("comercial_analises")
      .select("crm_lead_id, caixinha, servico, caixinha_em, fora_area")
      .eq("empresa_id", empresaId)
      .in("caixinha", [2, 3])
      .gte("caixinha_em", iso(somarDias(hoje, -21)))
      .order("caixinha_em", { ascending: false })
      .limit(80),
    // (d) orçamentos dos últimos 14 dias que não viraram OS, dentro da área.
    db
      .from("quotes")
      .select("id, crm_lead_id, cliente_nome, total, created_at, fora_da_area, numero")
      .eq("empresa_id", empresaId)
      .is("generated_work_order_id", null)
      .not("crm_lead_id", "is", null)
      .gte("created_at", iso(ha14))
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  // OS → lead (para abrir a conversa e não repetir a pessoa).
  const visitas = [
    ...((vencidas.data ?? []) as VisitaLinha[]),
    ...((canceladas.data ?? []) as VisitaLinha[]),
    ...((adiante.data ?? []) as VisitaLinha[]),
  ].filter(osVale);
  const osIds = [...new Set(visitas.map((v) => v.work_order_id))];
  const { data: leadsOs } = osIds.length
    ? await db
        .from("crm_leads")
        .select("id, linked_work_order_id")
        .eq("empresa_id", empresaId)
        .in("linked_work_order_id", osIds)
    : { data: [] };
  const leadDaOs = new Map<string, string>(
    ((leadsOs ?? []) as Array<{ id: string; linked_work_order_id: string }>).map((l) => [
      l.linked_work_order_id,
      l.id,
    ]),
  );
  // OS que já tem outra visita de hoje em diante não está "esperando remarcar".
  const { data: futuras } = osIds.length
    ? await db
        .from("visits")
        .select("work_order_id")
        .eq("empresa_id", empresaId)
        .in("work_order_id", osIds)
        .in("status", [...SITUACOES_ABERTAS, "Em deslocamento", "Em execução"])
        .gte("scheduled_date", hoje)
    : { data: [] };
  const comFutura = new Set(
    ((futuras ?? []) as Array<{ work_order_id: string }>).map((f) => f.work_order_id),
  );

  const lista: CandidatoDaVaga[] = [];
  const daVisita = (v: VisitaLinha, grupo: "remarcar" | "adiantar", detalhe: string) => {
    const leadId = leadDaOs.get(v.work_order_id) ?? null;
    const cliente = v.work_order?.customer_id ?? null;
    lista.push({
      grupo,
      // A mesma pessoa aparece uma vez só: pelo cliente, senão pelo lead, senão pela OS.
      chave: cliente ? `cli:${cliente}` : (leadId ?? `os:${v.work_order_id}`),
      nome: v.work_order?.customer?.full_name ?? "",
      detalhe,
      estofado: estofadoDe(v),
      conversaId: null,
      leadId,
      quando: v.scheduled_date,
    });
  };
  const os = (v: VisitaLinha) =>
    v.work_order?.os_number == null ? "OS" : `OS ${v.work_order.os_number}`;
  for (const v of (vencidas.data ?? []) as VisitaLinha[]) {
    if (!osVale(v) || /cancel|^Concluída$/i.test(v.work_order?.status ?? "")) continue;
    daVisita(v, "remarcar", `${os(v)}: visita de ${dataCurta(v.scheduled_date)} sem nova data`);
  }
  for (const v of (canceladas.data ?? []) as VisitaLinha[]) {
    if (!osVale(v) || comFutura.has(v.work_order_id) || v.work_order?.status === "Concluída")
      continue;
    daVisita(v, "remarcar", `${os(v)}: visita de ${dataCurta(v.scheduled_date)} cancelada`);
  }
  for (const v of (adiante.data ?? []) as VisitaLinha[]) {
    if (!osVale(v) || /cancel/i.test(v.work_order?.status ?? "")) continue;
    daVisita(v, "adiantar", `${os(v)} marcada para ${dataCurta(v.scheduled_date)}`);
  }

  // (b) e (d): leads abertos, sem OS, não perdidos.
  type Ficha = {
    crm_lead_id: string;
    caixinha: number;
    servico: string | null;
    caixinha_em: string;
    fora_area: boolean | null;
  };
  type Orc = {
    crm_lead_id: string;
    cliente_nome: string | null;
    total: number | string | null;
    created_at: string;
    fora_da_area: boolean | null;
    numero: number | string | null;
  };
  const fs = ((fichas.data ?? []) as Ficha[]).filter((f) => !f.fora_area);
  const qs = ((orcamentos.data ?? []) as Orc[]).filter((q) => !q.fora_da_area);
  const leadIds = [...new Set([...fs.map((f) => f.crm_lead_id), ...qs.map((q) => q.crm_lead_id)])];
  const { data: leads } = leadIds.length
    ? await db
        .from("crm_leads")
        .select("id, lead_name, is_open, perdido_em, linked_work_order_id, customer_id")
        .eq("empresa_id", empresaId)
        .in("id", leadIds)
    : { data: [] };
  const lead = new Map<string, { lead_name: string | null; customer_id: string | null }>(
    (
      (leads ?? []) as Array<{
        id: string;
        lead_name: string | null;
        is_open: boolean;
        perdido_em: string | null;
        linked_work_order_id: string | null;
        customer_id: string | null;
      }>
    )
      .filter((l) => l.is_open && !l.perdido_em && !l.linked_work_order_id)
      .map((l) => [l.id, l]),
  );
  for (const f of fs) {
    const l = lead.get(f.crm_lead_id);
    if (!l) continue;
    lista.push({
      grupo: "negociacao",
      chave: l.customer_id ? `cli:${l.customer_id}` : f.crm_lead_id,
      nome: l.lead_name ?? "",
      detalhe: f.caixinha === 3 ? "Retorno combinado com data" : "Em negociação",
      estofado: f.servico,
      conversaId: null,
      leadId: f.crm_lead_id,
      quando: f.caixinha_em,
    });
  }
  for (const q of qs) {
    const l = lead.get(q.crm_lead_id);
    if (!l) continue;
    lista.push({
      grupo: "orcamento",
      chave: l.customer_id ? `cli:${l.customer_id}` : q.crm_lead_id,
      nome: q.cliente_nome ?? l.lead_name ?? "",
      detalhe: `Orçamento${q.numero ? ` nº ${q.numero}` : ""} de ${reais(Number(q.total ?? 0))} em ${dataCurta(q.created_at.slice(0, 10))}`,
      estofado: null,
      conversaId: null,
      leadId: q.crm_lead_id,
      quando: q.created_at,
    });
  }

  const ordenados = ordenarCandidatos(lista);
  // Conversa de cada lead (para o botão "Abrir conversa").
  const ids = ordenados.map((c) => c.leadId).filter((x): x is string => Boolean(x));
  if (ids.length) {
    const { data: convs } = await db
      .from("conversas")
      .select("id, crm_lead_id, ultima_atividade_em")
      .eq("empresa_id", empresaId)
      .in("crm_lead_id", ids)
      .order("ultima_atividade_em", { ascending: false, nullsFirst: false });
    const conversa = new Map<string, string>();
    for (const c of (convs ?? []) as Array<{ id: string; crm_lead_id: string }>)
      if (!conversa.has(c.crm_lead_id)) conversa.set(c.crm_lead_id, c.id);
    for (const c of ordenados) c.conversaId = c.leadId ? (conversa.get(c.leadId) ?? null) : null;
  }
  return ordenados;
}

/**
 * Varredura: push para admin e atendentes às 8h30, 10h30, 13h30 e 16h enquanto houver vaga (uma
 * vez por pessoa e horário). Usa a mesma chave de preferência das tarefas da Tatiana.
 */
export async function rodarAlarmeDeVagas(
  agora = agoraSP(),
): Promise<{ empresas: number; enviados: number }> {
  const saida = { empresas: 0, enviados: 0 };
  const slot = pushDaHora(agora.hora);
  if (!slot) return saida;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;
  const { data: bases } = await db.from("agenda_horarios_base").select("empresa_id");
  const empresas = [
    ...new Set(((bases ?? []) as Array<{ empresa_id: string }>).map((b) => b.empresa_id)),
  ];
  if (!empresas.length) return saida;
  const { pessoasComCelular, enviarParaPessoa, registrarUmaVez } =
    await import("@/lib/push/notificacoes.server");
  const { querReceber } = await import("@/lib/push/notificacoes");
  for (const emp of empresas) {
    try {
      const { vagas, hoje } = await lerVagas(db, emp, agora);
      if (!vagas.length) continue;
      saida.empresas++;
      const pessoas = ((await pessoasComCelular(db as never, emp)).get(emp) ?? []).filter(
        (p) =>
          (p.papel === "admin" || p.papel === "atendente") &&
          querReceber("tatiana_tarefas", p.papel, p.pref),
      );
      if (!pessoas.length) continue;
      const candidatos = await candidatosDasVagas(db, emp, hoje, vagas.at(-1)!.data);
      const t = textoDoPush(vagas, hoje, candidatos.length);
      if (!t) continue;
      for (const p of pessoas) {
        const id = await registrarUmaVez(
          db as never,
          emp,
          p.userId,
          "tatiana_tarefas",
          `vaga:${hoje}:${slot}`,
          t.titulo,
        );
        if (!id) continue;
        const r = await enviarParaPessoa(db as never, p.celulares, {
          titulo: t.titulo,
          corpo: t.corpo,
          url: "/vagas",
          tag: `vaga-${hoje}`,
        });
        saida.enviados += r.enviados;
      }
    } catch (e) {
      console.error("Alarme de vaga: falha", emp.slice(0, 8), e instanceof Error ? e.message : e);
    }
  }
  return saida;
}

export { HORAS_DO_PUSH };
