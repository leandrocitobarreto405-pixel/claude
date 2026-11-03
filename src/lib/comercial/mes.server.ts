/**
 * Tatiana, gerente do mês, etapa 1 (servidor): meta diária, previsão pelos orçamentos abertos,
 * agenda livre até o fim do mês e alertas de gerente. Sem IA. Calculado na hora para a aba "Mês"
 * (cliente da pessoa, RLS) e uma vez por manhã pela varredura (chave de serviço) para avisar o
 * admin no app e por push. Nada é enviado a clientes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SELECT_OS_VENDIDO } from "@/lib/consultas";
import { regrasDaAgenda, type HorarioBase, type Ocupacao } from "@/lib/promocao";
import {
  liquidoDaVisita,
  osConta,
  vendidoNoPeriodo,
  visitasComValor,
  type OsVendido,
} from "@/lib/vendido";
import { paraOsVendido } from "@/lib/vendido-dados";
import { CAIXINHAS } from "./tatiana";
import {
  agendaPorDia,
  alertasDoMes,
  conversaoPorServico,
  diasVazios,
  fimDoMes,
  fraseDaMeta,
  metaDoMes,
  previsaoDosOrcamentos,
  servicoDosItens,
  servicoDoTexto,
  somarDias,
  textoPushAlertas,
  type Alerta,
  type ConversaoServicoPeriodo,
  type DiaAgenda,
  type FichaConversao,
  type LeadsOrigem,
  type MetaDoMes,
  type Objecao,
  type OrcamentoAberto,
  type PrevisaoServico,
  type Servico,
} from "./mes";

type Db = SupabaseClient;

export type MesTatiana = {
  hoje: string;
  mes: string;
  meta: MetaDoMes;
  frase: string;
  previsao: {
    total: number;
    porServico: PrevisaoServico[];
    /** Vendido pela data do serviço + previsto. */
    chegaA: number;
    pctDaMeta: number | null;
  };
  agenda: {
    livres: number;
    base: number;
    dias: DiaAgenda[];
    vazios: DiaAgenda[];
    /** Feriados bloqueados até o fim do mês (sem atendimento). */
    feriados?: Array<{ data: string; nome: string }>;
  };
  leadsPorOrigem: LeadsOrigem[];
  conversaoPorServico: ConversaoServicoPeriodo[];
  objecoes: Objecao[];
  perdidos14d: number;
  alertas: Alerta[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** OS com serviço no período (todas as visitas), só da empresa. */
async function osDoPeriodo(db: Db, emp: string, de: string, ate: string): Promise<OsVendido[]> {
  const { data } = await db
    .from("visits")
    .select("work_order_id")
    .eq("empresa_id", emp)
    .neq("status", "Cancelado")
    .or(
      `and(scheduled_date.gte.${de},scheduled_date.lte.${ate}),and(completion_date.gte.${de},completion_date.lte.${ate})`,
    )
    .limit(5000);
  const ids = [
    ...new Set(((data ?? []) as Array<{ work_order_id: string }>).map((v) => v.work_order_id)),
  ].filter(Boolean);
  const saida: OsVendido[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: oss } = await db
      .from("work_orders")
      .select(SELECT_OS_VENDIDO)
      .eq("empresa_id", emp)
      .in("id", ids.slice(i, i + 200));
    for (const o of (oss ?? []) as unknown as Parameters<typeof paraOsVendido>[0][])
      saida.push(paraOsVendido(o));
  }
  return saida;
}

/** OS fechadas no período (data da venda), só da empresa. */
export async function osVendidasNoPeriodo(db: Db, emp: string, de: string, ate: string) {
  const { data } = await db
    .from("work_orders")
    .select(SELECT_OS_VENDIDO)
    .eq("empresa_id", emp)
    .gte("sale_date", de)
    .lte("sale_date", ate)
    .limit(5000);
  return ((data ?? []) as unknown as Parameters<typeof paraOsVendido>[0][]).map(paraOsVendido);
}

/** Valor líquido de uma OS inteira (todas as visitas, sem o repasse). */
export function liquidoDaOs(os: OsVendido, hoje: string): number {
  return r2(visitasComValor(os, hoje).reduce((s, v) => s + liquidoDaVisita(v), 0));
}

async function orcamentosAbertos(db: Db, emp: string, hoje: string): Promise<OrcamentoAberto[]> {
  const desde = new Date(
    Date.parse(`${somarDias(hoje, -30)}T00:00:00-03:00`).valueOf(),
  ).toISOString();
  const { data } = await db
    .from("quotes")
    .select("id, total, created_at, valido_ate, crm_lead_id, quote_items(tipo_servico)")
    .eq("empresa_id", emp)
    .eq("status", "enviado")
    .is("generated_work_order_id", null)
    .or(`valido_ate.gte.${hoje},created_at.gte.${desde}`)
    .order("created_at", { ascending: false })
    .limit(1000);
  type Linha = {
    id: string;
    total: number | string;
    crm_lead_id: string | null;
    quote_items: Array<{ tipo_servico: string }> | null;
  };
  // Um orçamento por lead (o mais recente); sem lead, cada um conta.
  const vistos = new Set<string>();
  const saida: OrcamentoAberto[] = [];
  for (const q of (data ?? []) as Linha[]) {
    if (q.crm_lead_id) {
      if (vistos.has(q.crm_lead_id)) continue;
      vistos.add(q.crm_lead_id);
    }
    saida.push({
      id: q.id,
      total: Number(q.total ?? 0),
      servico: servicoDosItens((q.quote_items ?? []).map((i) => i.tipo_servico)),
    });
  }
  return saida;
}

type Ficha = FichaConversao & {
  analisado_em: string | null;
  caixinha: number | null;
  perda_motivo_final_id: string | null;
  motivo_sugerido_id: string | null;
};

async function fichas90d(db: Db, emp: string, hoje: string): Promise<Ficha[]> {
  const { data } = await db
    .from("comercial_analises")
    .select("servico, resultado, analisado_em, caixinha, perda_motivo_final_id, motivo_sugerido_id")
    .eq("empresa_id", emp)
    .eq("status", "ok")
    .gte("analisado_em", `${somarDias(hoje, -90)}T00:00:00-03:00`)
    .limit(3000);
  return (data ?? []) as Ficha[];
}

function conversaoAtualAnterior(fichas: Ficha[], hoje: string): ConversaoServicoPeriodo[] {
  const corte28 = `${somarDias(hoje, -28)}T00:00:00-03:00`;
  const corte56 = `${somarDias(hoje, -56)}T00:00:00-03:00`;
  const vazio = () => ({ comOrcamento: 0, vendas: 0 });
  const m = new Map<Servico, ConversaoServicoPeriodo>();
  for (const f of fichas) {
    if (!f.analisado_em || !f.resultado || f.resultado === "sem_orcamento") continue;
    const s = servicoDoTexto(f.servico);
    const l = m.get(s) ?? { servico: s, atual: vazio(), anterior: vazio() };
    const bloco =
      f.analisado_em >= corte28 ? l.atual : f.analisado_em >= corte56 ? l.anterior : null;
    if (bloco) {
      bloco.comOrcamento++;
      if (f.resultado === "vendeu") bloco.vendas++;
    }
    m.set(s, l);
  }
  return [...m.values()];
}

async function objecoes14d(
  db: Db,
  emp: string,
  fichas: Ficha[],
  hoje: string,
): Promise<{ objecoes: Objecao[]; perdidos: number }> {
  const corte = `${somarDias(hoje, -14)}T00:00:00-03:00`;
  const perdidas = fichas.filter(
    (f) =>
      f.analisado_em &&
      f.analisado_em >= corte &&
      (f.resultado === "perdeu" || f.resultado === "sem_desfecho"),
  );
  const motivoIds = [
    ...new Set(
      perdidas
        .map((f) => f.perda_motivo_final_id ?? f.motivo_sugerido_id)
        .filter(Boolean) as string[],
    ),
  ];
  const nomes = new Map<string, string>();
  if (motivoIds.length) {
    const { data } = await db
      .from("config_options")
      .select("id, name")
      .eq("empresa_id", emp)
      .in("id", motivoIds);
    for (const o of (data ?? []) as Array<{ id: string; name: string }>) nomes.set(o.id, o.name);
  }
  const contagem = new Map<string, number>();
  for (const f of perdidas) {
    const caixinha = f.caixinha && [4, 5, 7, 8].includes(f.caixinha) ? f.caixinha : null;
    const nome =
      (caixinha ? CAIXINHAS[caixinha as keyof typeof CAIXINHAS] : null) ??
      nomes.get(f.perda_motivo_final_id ?? f.motivo_sugerido_id ?? "") ??
      null;
    if (!nome) continue;
    contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
  }
  return {
    objecoes: [...contagem.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n),
    perdidos: perdidas.length,
  };
}

async function leadsPorOrigem(db: Db, emp: string, hoje: string): Promise<LeadsOrigem[]> {
  const { data } = await db
    .from("crm_leads")
    .select("first_contact_date, sales_origin_id")
    .eq("empresa_id", emp)
    .eq("entrada", "receptivo")
    .gte("first_contact_date", somarDias(hoje, -34))
    .lte("first_contact_date", hoje)
    .limit(5000);
  const leads = (data ?? []) as Array<{
    first_contact_date: string;
    sales_origin_id: string | null;
  }>;
  const ids = [...new Set(leads.map((l) => l.sales_origin_id).filter(Boolean) as string[])];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data: os } = await db
      .from("config_options")
      .select("id, name")
      .eq("empresa_id", emp)
      .in("id", ids);
    for (const o of (os ?? []) as Array<{ id: string; name: string }>) nomes.set(o.id, o.name);
  }
  const inicioAtual = somarDias(hoje, -6);
  const porOrigem = new Map<string, { atual: number; anteriores: number }>();
  const total = { atual: 0, anteriores: 0 };
  for (const l of leads) {
    const origem = (l.sales_origin_id && nomes.get(l.sales_origin_id)) || "Não identificada";
    const o = porOrigem.get(origem) ?? { atual: 0, anteriores: 0 };
    if (l.first_contact_date >= inicioAtual) {
      o.atual++;
      total.atual++;
    } else {
      o.anteriores++;
      total.anteriores++;
    }
    porOrigem.set(origem, o);
  }
  const linhas = [...porOrigem.entries()]
    .map(([origem, o]) => ({ origem, atual: o.atual, media4: r2(o.anteriores / 4) }))
    .sort((a, b) => b.media4 + b.atual - (a.media4 + a.atual));
  return [
    { origem: "Todas as origens", atual: total.atual, media4: r2(total.anteriores / 4) },
    ...linhas,
  ];
}

export async function agendaAteFimDoMes(
  db: Db,
  emp: string,
  hoje: string,
  fim: string,
  diasUteis: number[],
) {
  const [{ data: tecs }, { data: base }, { data: vis }, { data: cfgAgenda }, feriados] =
    await Promise.all([
      db
        .from("technicians")
        .select("id, name")
        .eq("empresa_id", emp)
        .eq("active", true)
        .eq("parceiro", false),
      db.from("agenda_horarios_base").select("tecnico_id, dia_semana, hora").eq("empresa_id", emp),
      db
        .from("visits")
        .select(
          "scheduled_date, scheduled_time, technician_id, status, visit_value, final_value, ocupa_dia",
        )
        .eq("empresa_id", emp)
        .gte("scheduled_date", hoje)
        .lte("scheduled_date", fim)
        .limit(5000),
      db
        .from("agenda_configuracoes")
        .select("duracao_atendimento_min, dia_inteiro_valor")
        .eq("empresa_id", emp)
        .maybeSingle(),
      (async () => {
        const { bloqueadosNoPeriodo } = await import("@/lib/feriados.server");
        return bloqueadosNoPeriodo(db, emp, hoje, fim);
      })(),
    ]);
  const c = cfgAgenda as {
    duracao_atendimento_min?: number | null;
    dia_inteiro_valor?: number | string | null;
  } | null;
  const regras = regrasDaAgenda({
    duracaoMin: c?.duracao_atendimento_min ?? null,
    diaInteiroValor: c?.dia_inteiro_valor ?? null,
  });
  const nomes = new Map(
    ((tecs ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  );
  const horarios: HorarioBase[] = (
    (base ?? []) as Array<{
      tecnico_id: string;
      dia_semana: number;
      hora: string;
    }>
  )
    .filter((h) => nomes.has(h.tecnico_id))
    .map((h) => ({
      tecnicoId: h.tecnico_id,
      tecnico: nomes.get(h.tecnico_id) ?? "",
      diaSemana: h.dia_semana,
      hora: h.hora,
    }));
  const ocupacoes = new Map<string, Ocupacao[]>();
  for (const v of (vis ?? []) as Array<{
    scheduled_date: string;
    scheduled_time: string;
    technician_id: string | null;
    status: string;
    visit_value: number | string | null;
    final_value: number | string | null;
    ocupa_dia: boolean | null;
  }>)
    ocupacoes.set(v.scheduled_date, [
      ...(ocupacoes.get(v.scheduled_date) ?? []),
      {
        tecnicoId: v.technician_id,
        hora: v.scheduled_time,
        status: v.status,
        valor: Number(v.final_value ?? v.visit_value ?? 0),
        ocupaDia: v.ocupa_dia ?? null,
      },
    ]);
  const dias = agendaPorDia({
    de: hoje,
    ate: fim,
    diasUteis,
    base: horarios,
    ocupacoes,
    regras,
    feriados,
  });
  return {
    livres: dias.reduce((s, d) => s + d.livres, 0),
    base: dias.reduce((s, d) => s + d.base, 0),
    dias,
    vazios: diasVazios(dias, hoje),
    bloqueados: feriados,
  };
}

export async function calcularMes(
  db: Db,
  emp: string,
  hoje: string,
  diasUteis: number[],
): Promise<MesTatiana> {
  const mes = hoje.slice(0, 7);
  const inicio = `${mes}-01`;
  const fim = fimDoMes(mes);
  const [{ data: metaRow }, oss, vendidas, abertos, fichas, origens, agenda, { data: camps }] =
    await Promise.all([
      db
        .from("monthly_goals")
        .select("goal_amount")
        .eq("empresa_id", emp)
        .eq("month", inicio)
        .maybeSingle(),
      osDoPeriodo(db, emp, inicio, fim),
      osVendidasNoPeriodo(db, emp, inicio, fim),
      orcamentosAbertos(db, emp, hoje),
      fichas90d(db, emp, hoje),
      leadsPorOrigem(db, emp, hoje),
      agendaAteFimDoMes(db, emp, hoje, fim, diasUteis),
      db
        .from("comercial_campanhas")
        .select("campanha_id, numeros, mkt_campanhas(nome)")
        .eq("empresa_id", emp)
        .gte("janela_inicio", somarDias(hoje, -45)),
    ]);
  const campanhas = (
    (camps ?? []) as Array<{
      campanha_id: string;
      numeros: { enviados?: number; descadastros?: number } | null;
      mkt_campanhas: { nome?: string } | null;
    }>
  ).map((k) => ({
    id: k.campanha_id,
    nome: k.mkt_campanhas?.nome ?? "campanha",
    enviados: Number(k.numeros?.enviados ?? 0),
    descadastros: Number(k.numeros?.descadastros ?? 0),
  }));
  const servico = vendidoNoPeriodo(oss, { de: inicio, ate: fim }, hoje);
  const vendidoVenda = r2(vendidas.filter(osConta).reduce((s, os) => s + liquidoDaOs(os, hoje), 0));
  const meta = metaDoMes({
    meta: metaRow ? Number((metaRow as { goal_amount: number | string }).goal_amount) : null,
    vendidoVenda,
    vendidoServico: servico,
    hoje,
    mes,
    diasUteis,
    bloqueados: agenda.bloqueados,
  });
  const previsao = previsaoDosOrcamentos(abertos, conversaoPorServico(fichas));
  const chegaA = r2(servico.valor + previsao.total);
  const conv = conversaoAtualAnterior(fichas, hoje);
  const { objecoes, perdidos } = await objecoes14d(db, emp, fichas, hoje);
  const alertas = alertasDoMes({
    hoje,
    mes,
    meta: meta.meta,
    agenda: agenda.dias,
    leadsPorOrigem: origens.filter((o) => o.origem !== "Todas as origens"),
    conversaoPorServico: conv,
    objecoes,
    perdidos14d: perdidos,
    campanhas,
  });
  return {
    hoje,
    mes,
    meta,
    frase: fraseDaMeta(meta),
    previsao: {
      ...previsao,
      chegaA,
      pctDaMeta: meta.meta ? Math.round((chegaA / meta.meta) * 1000) / 10 : null,
    },
    agenda,
    leadsPorOrigem: origens,
    conversaoPorServico: conv,
    objecoes,
    perdidos14d: perdidos,
    alertas,
  };
}

// ---------------------------------------------------------------- manhã (varredura)

async function avisarUmaVez(db: Db, emp: string, a: Alerta): Promise<boolean> {
  const referencia = `gerente_alerta:${a.chave}`;
  const { data: ja } = await db
    .from("mkt_avisos")
    .select("id")
    .eq("empresa_id", emp)
    .eq("referencia", referencia)
    .limit(1);
  if (ja?.length) return false;
  await db.from("mkt_avisos").insert({
    empresa_id: emp,
    tipo: "gerente_alerta",
    titulo: `Tatiana: ${a.titulo}`,
    mensagem: a.texto,
    so_no_app: true,
    referencia,
  });
  return true;
}

/**
 * 8h00–8h20 (São Paulo), empresas com a Tatiana ligada: calcula os alertas do dia e avisa o admin
 * uma vez por chave (aviso no app + push). O recálculo é barato (só consultas); a trava é a chave.
 */
export async function rodarMesDaTatiana(
  db: Db,
  configs: Array<{ empresa_id: string; dias_uteis: number[] | null }>,
  hojeSP: string,
  horaSP: string,
): Promise<Record<string, unknown>> {
  if (horaSP < "08:00" || horaSP >= "08:20") return {};
  const { pessoasComCelular, enviarParaPessoa, registrarUmaVez } =
    await import("@/lib/push/notificacoes.server");
  const { querReceber } = await import("@/lib/push/notificacoes");
  const saida: Record<string, unknown> = {};
  for (const cfg of configs) {
    const emp = cfg.empresa_id;
    try {
      const m = await calcularMes(db, emp, hojeSP, cfg.dias_uteis ?? [1, 2, 3, 4, 5, 6]);
      const novos: Alerta[] = [];
      for (const a of m.alertas) if (await avisarUmaVez(db, emp, a)) novos.push(a);
      let pushes = 0;
      if (novos.length) {
        const pessoas = ((await pessoasComCelular(db as never, emp)).get(emp) ?? []).filter(
          (p) => p.papel === "admin" && querReceber("alerta_gerente", p.papel, p.pref),
        );
        for (const p of pessoas) {
          const ids = [];
          for (const a of novos) {
            const id = await registrarUmaVez(
              db as never,
              emp,
              p.userId,
              "alerta_gerente",
              a.chave,
              a.titulo,
            );
            if (id) ids.push(id);
          }
          if (!ids.length) continue;
          const t = textoPushAlertas(novos);
          const r = await enviarParaPessoa(db as never, p.celulares, {
            ...t,
            url: "/gerente-comercial?aba=mes",
            tag: `tatiana-mes-${hojeSP}`,
          });
          pushes += r.enviados;
        }
      }
      saida[`mes_${emp.slice(0, 8)}`] = { alertas: m.alertas.length, novos: novos.length, pushes };
    } catch (e) {
      saida[`mes_${emp.slice(0, 8)}`] = { erro: e instanceof Error ? e.message : String(e) };
    }
  }
  return saida;
}
