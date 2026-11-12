/**
 * Lead sem novidade não passa pela IA (12/11): lê do banco os sinais de cada lead que entraria na
 * noite e separa quem passa pela IA de quem fica como está. Só leitura: nada aqui cria, cancela ou
 * altera tarefa. Na dúvida (consulta que falhou ou veio cortada), o lead passa pela IA.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  escolherExemplos,
  lerOuPular,
  type ExemploPulado,
  type MotivoDaLeitura,
  type RelatorioDosPulados,
  type SinaisDoLead,
} from "./sem-novidade";

type Db = SupabaseClient;

/** Leads por consulta (mantém as respostas bem abaixo do limite de linhas da API). */
const PARTE = 40;
const LIMITE = 1000;
/** A releitura é semanal: o que importa aconteceu nos últimos 8 dias. */
const JANELA_MS = 8 * 86_400_000;
const FOLGA_DA_LEITURA_MS = 5 * 60_000;
const SUBSTITUIDA = "substituído por um novo follow-up";

export type LeadDaNoite = {
  id: string;
  linked_work_order_id: string | null;
  normalized_phone: string | null;
  os_criada_em: string | null;
  orcamento_enviado_em: string | null;
  agendado_em: string | null;
  realizado_em: string | null;
  /** Follow-up esquecido (toque vencido que ninguém fez): sempre passa. */
  esquecido: boolean;
};

export type SeparacaoDaNoite = {
  /** Leads que ficam fora da leitura desta noite. */
  pulados: Set<string>;
  /** Leads que passam só pela releitura semanal (a tarefa que já está na lista é mantida). */
  relidos: string[];
  /** Pulados que têm tarefa na lista (no fim da noite ela tem de continuar lá). */
  comTarefa: string[];
  relatorio: RelatorioDosPulados;
};

const maior = (...datas: Array<string | null | undefined>): string | null => {
  let m: string | null = null;
  for (const d of datas) if (d && (!m || Date.parse(d) > Date.parse(m))) m = d;
  return m;
};
const menor = (datas: string[]): string | null =>
  datas.length ? datas.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)) : null;
const final4 = (telefone: string | null) => (telefone ?? "").replace(/\D/g, "").slice(-4);

type Ficha = {
  crm_lead_id: string;
  caixinha: number | null;
  resumo_dia: string | null;
  resumo_ate: string | null;
  leitura_completa_em: string | null;
  rever_em: string | null;
  rever_motivo: string | null;
  etiquetas: { retorno_prometido_em?: string | null } | null;
};
type Tarefa = {
  crm_lead_id: string;
  status: string;
  origem: string | null;
  responsavel: string | null;
  result: string | null;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string | null;
  adiamentos: number | null;
  trilha: string | null;
  scheduled_at: string;
};

export async function separarSemNovidade(
  db: Db,
  empresaId: string,
  leads: LeadDaNoite[],
  o: { agora: Date; hoje: string },
): Promise<SeparacaoDaNoite> {
  const amanha = new Date(Date.parse(`${o.hoje}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const datas = {
    agora: o.agora,
    fimDeHoje: new Date(`${o.hoje}T23:59:59-03:00`).toISOString(),
    fimDeAmanha: new Date(`${amanha}T23:59:59-03:00`).toISOString(),
  };
  const desde = new Date(o.agora.getTime() - JANELA_MS).toISOString();
  const pulados = new Set<string>();
  const relidos: string[] = [];
  const comTarefa: string[] = [];
  const exemplos: ExemploPulado[] = [];
  const relatorio: RelatorioDosPulados = {
    total: 0,
    porSituacao: { tarefa_na_lista: 0, esperando_data: 0, sem_pendencia: 0 },
    comTarefa: 0,
    exemplos: [],
    lidos: {},
  };
  const contarLido = (m: MotivoDaLeitura) => {
    relatorio.lidos[m] = (relatorio.lidos[m] ?? 0) + 1;
  };

  // Noites de conferência não são leitura de verdade (não gravam ficha nem tarefa).
  const { data: confs } = await db
    .from("comercial_noites")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("modo", "conferencia")
    .gte("iniciada_em", desde);
  const deConferencia = new Set(((confs ?? []) as Array<{ id: string }>).map((n) => n.id));

  for (let i = 0; i < leads.length; i += PARTE) {
    const parte = leads.slice(i, i + PARTE);
    const ids = parte.map((l) => l.id);
    const [rf, rd, rt] = await Promise.all([
      db
        .from("comercial_analises")
        .select(
          "crm_lead_id, caixinha, resumo_dia, resumo_ate, leitura_completa_em, rever_em, rever_motivo, etiquetas",
        )
        .eq("empresa_id", empresaId)
        .in("crm_lead_id", ids),
      db
        .from("comercial_decisoes")
        .select("crm_lead_id, noite_id, criado_em")
        .eq("empresa_id", empresaId)
        .in("crm_lead_id", ids)
        .gte("criado_em", desde)
        .order("criado_em", { ascending: false })
        .limit(LIMITE),
      db
        .from("crm_followups")
        .select(
          "crm_lead_id, status, origem, responsavel, result, notes, created_at, completed_at, updated_at, adiamentos, trilha, scheduled_at",
        )
        .eq("empresa_id", empresaId)
        .in("crm_lead_id", ids)
        .or(`status.eq.Pendente,updated_at.gte.${desde}`)
        .limit(LIMITE),
    ]);
    const decisoes = (rd.data ?? []) as Array<{
      crm_lead_id: string;
      noite_id: string;
      criado_em: string;
    }>;
    const tarefas = (rt.data ?? []) as Tarefa[];
    // Consulta que falhou ou veio cortada: não dá para afirmar que não há novidade.
    let incerto =
      Boolean(rf.error || rd.error || rt.error) ||
      decisoes.length >= LIMITE ||
      tarefas.length >= LIMITE;
    const ficha = new Map(((rf.data ?? []) as Ficha[]).map((f) => [f.crm_lead_id, f]));
    const lidaEm = new Map<string, string>();
    for (const d of decisoes)
      if (!deConferencia.has(d.noite_id) && !lidaEm.has(d.crm_lead_id))
        lidaEm.set(d.crm_lead_id, d.criado_em);

    // Até onde a última leitura cobriu a conversa: o resumo ou, sem ele, a própria leitura.
    const coberto = new Map<string, number>();
    for (const l of parte) {
      const lida = lidaEm.get(l.id);
      if (!lida) continue;
      const ate = Date.parse(ficha.get(l.id)?.resumo_ate ?? "");
      coberto.set(l.id, Number.isNaN(ate) ? Date.parse(lida) - FOLGA_DA_LEITURA_MS : ate);
    }
    const lidos = parte.filter((l) => lidaEm.has(l.id));
    const idsLidos = lidos.map((l) => l.id);
    const minLida = menor(idsLidos.map((id) => lidaEm.get(id) as string));
    const minCoberto = idsLidos.length
      ? new Date(Math.min(...idsLidos.map((id) => coberto.get(id) as number))).toISOString()
      : null;
    const osIds = lidos.map((l) => l.linked_work_order_id).filter((x): x is string => Boolean(x));
    type Resposta = { data: unknown[] | null; error: unknown };
    const vazio: Resposta = { data: [], error: null };
    const temLidos = Boolean(minLida && minCoberto);
    const [rm, rq, ro, rv, rp] = (await Promise.all([
      temLidos
        ? db
            .from("whatsapp_messages")
            .select("crm_lead_id, message_timestamp, chatwoot_message_id")
            .eq("empresa_id", empresaId)
            .eq("privada", false)
            .in("crm_lead_id", idsLidos)
            .gt("message_timestamp", minCoberto as string)
            .order("message_timestamp", { ascending: false })
            .limit(LIMITE)
        : vazio,
      temLidos
        ? db
            .from("quotes")
            .select("crm_lead_id, updated_at")
            .eq("empresa_id", empresaId)
            .in("crm_lead_id", idsLidos)
            .gt("updated_at", minLida as string)
            .limit(LIMITE)
        : vazio,
      temLidos && osIds.length
        ? db
            .from("work_orders")
            .select("id, updated_at")
            .eq("empresa_id", empresaId)
            .in("id", osIds)
        : vazio,
      temLidos && osIds.length
        ? db
            .from("visits")
            .select("work_order_id, updated_at")
            .eq("empresa_id", empresaId)
            .in("work_order_id", osIds)
            .gt("updated_at", minLida as string)
            .limit(LIMITE)
        : vazio,
      temLidos && osIds.length
        ? db
            .from("payments")
            .select("work_order_id, updated_at")
            .eq("empresa_id", empresaId)
            .in("work_order_id", osIds)
            .gt("updated_at", minLida as string)
            .limit(LIMITE)
        : vazio,
    ])) as [Resposta, Resposta, Resposta, Resposta, Resposta];
    const msgs = (rm.data ?? []) as Array<{
      crm_lead_id: string;
      message_timestamp: string;
      chatwoot_message_id: number | string | null;
    }>;
    const quotes = (rq.data ?? []) as Array<{ crm_lead_id: string; updated_at: string }>;
    const oss = (ro.data ?? []) as Array<{ id: string; updated_at: string }>;
    const visitas = (rv.data ?? []) as Array<{ work_order_id: string; updated_at: string }>;
    const pags = (rp.data ?? []) as Array<{ work_order_id: string; updated_at: string }>;
    if (
      rm.error ||
      rq.error ||
      ro.error ||
      rv.error ||
      rp.error ||
      [msgs, quotes, visitas, pags].some((x) => x.length >= LIMITE)
    )
      incerto = true;

    // Mensagens novas de cada lead; disparo de campanha não conta como conversa.
    const novas = msgs.filter(
      (m) => Date.parse(m.message_timestamp) > (coberto.get(m.crm_lead_id) ?? Infinity),
    );
    const idsChatwoot = [
      ...new Set(
        novas.map((m) => m.chatwoot_message_id).filter((x): x is number | string => x != null),
      ),
    ];
    const deCampanha = new Set<string>();
    for (let j = 0; j < idsChatwoot.length; j += 200) {
      const { data: envs, error } = await db
        .from("mkt_envios")
        .select("chatwoot_message_id")
        .eq("empresa_id", empresaId)
        .in("chatwoot_message_id", idsChatwoot.slice(j, j + 200));
      // Sem conseguir conferir, a mensagem conta como conversa (o lead passa pela IA).
      if (error) continue;
      for (const e of (envs ?? []) as Array<{ chatwoot_message_id: number | string | null }>)
        if (e.chatwoot_message_id != null) deCampanha.add(String(e.chatwoot_message_id));
    }
    const ultimaMensagem = new Map<string, string>();
    for (const m of novas) {
      if (m.chatwoot_message_id != null && deCampanha.has(String(m.chatwoot_message_id))) continue;
      ultimaMensagem.set(
        m.crm_lead_id,
        maior(ultimaMensagem.get(m.crm_lead_id), m.message_timestamp) as string,
      );
    }

    const porLead = <T extends { crm_lead_id: string }>(linhas: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of linhas) m.set(x.crm_lead_id, [...(m.get(x.crm_lead_id) ?? []), x]);
      return m;
    };
    const tarefasDe = porLead(tarefas);
    const quotesDe = porLead(quotes);
    const osEm = new Map(oss.map((w) => [w.id, w.updated_at]));

    for (const l of parte) {
      const f = ficha.get(l.id) ?? null;
      const lida = lidaEm.get(l.id) ?? null;
      const ts = tarefasDe.get(l.id) ?? [];
      const naLista = ts
        .filter((t) => t.status === "Pendente" && t.origem === "gerente")
        .filter((t) => t.responsavel === "equipe")
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      // Desfecho de tarefa (feita, pulada, cancelada) ou follow-up marcado por outra pessoa.
      const mudancaDeTarefa = maior(
        ...ts.map((t) => {
          if (t.status === "Pendente") return t.origem === "gerente" ? null : t.created_at;
          if (t.result === SUBSTITUIDA || (t.notes ?? "").startsWith("substituída pela"))
            return null;
          return t.completed_at ?? t.updated_at;
        }),
      );
      const os = l.linked_work_order_id;
      const prometido = f?.etiquetas?.retorno_prometido_em;
      // Retorno combinado: follow-up de retorno marcado (trilha C) ou a data que o cliente
      // prometeu. O campo retorno_combinado_em do lead não serve: espelha a data da própria tarefa.
      const retornos = [
        ...ts.filter((t) => t.status === "Pendente" && t.trilha === "C").map((t) => t.scheduled_at),
        prometido && /^\d{4}-\d{2}-\d{2}$/.test(prometido) ? `${prometido}T12:00:00-03:00` : null,
      ].filter((r): r is string => Boolean(r));
      const sinais: SinaisDoLead = {
        lidaEm: lida,
        // Sem resumo guardado, toda leitura anterior foi da conversa inteira.
        completaEm: f?.resumo_dia?.trim() ? f.leitura_completa_em : lida,
        resumoAte: f?.resumo_dia?.trim() ? f.resumo_ate : null,
        esquecido: l.esquecido,
        ultimaMensagemEm: ultimaMensagem.get(l.id) ?? null,
        app: {
          orcamento: maior(
            ...(quotesDe.get(l.id) ?? []).map((q) => q.updated_at),
            l.orcamento_enviado_em,
          ),
          os: maior(os ? osEm.get(os) : null, l.os_criada_em),
          visita: maior(
            ...visitas.filter((v) => v.work_order_id === os).map((v) => v.updated_at),
            l.agendado_em,
            l.realizado_em,
          ),
          pagamento: maior(...pags.filter((p) => p.work_order_id === os).map((p) => p.updated_at)),
          tarefa: mudancaDeTarefa,
        },
        reverEm: f?.rever_em ?? null,
        reverMotivo: f?.rever_motivo ?? null,
        retornoEm:
          retornos.find(
            (r) =>
              lida !== null &&
              Date.parse(r) > Date.parse(lida) &&
              Date.parse(r) <= Date.parse(datas.fimDeAmanha),
          ) ?? null,
        tarefaPendente: naLista.length > 0,
      };
      const leitura = lerOuPular(sinais, datas);
      if (leitura.passa) {
        contarLido(leitura.motivo);
        if (leitura.motivo === "releitura_semanal") relidos.push(l.id);
        continue;
      }
      if (incerto) {
        contarLido("na_duvida");
        continue;
      }
      pulados.add(l.id);
      relatorio.total++;
      relatorio.porSituacao[leitura.situacao]++;
      if (naLista.length) {
        relatorio.comTarefa++;
        comTarefa.push(l.id);
      }
      exemplos.push({
        lead: l.id,
        final: final4(l.normalized_phone),
        situacao: leitura.situacao,
        caixinha: f?.caixinha ?? null,
        lidaEm: lida,
        ultimaMensagemEm: null,
        reverEm: f?.rever_em ?? null,
        tarefa: naLista[0]
          ? { criadaEm: naLista[0].created_at, adiamentos: naLista[0].adiamentos ?? 0 }
          : null,
      });
    }
  }
  // Para a conferência do dono: a última mensagem de cada exemplo (qualquer lado, fora nota interna).
  relatorio.exemplos = escolherExemplos(exemplos);
  for (const e of relatorio.exemplos) {
    const { data: m } = await db
      .from("whatsapp_messages")
      .select("message_timestamp")
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", e.lead)
      .eq("privada", false)
      .order("message_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    e.ultimaMensagemEm = (m as { message_timestamp?: string } | null)?.message_timestamp ?? null;
  }
  return { pulados, relidos, comTarefa, relatorio };
}
