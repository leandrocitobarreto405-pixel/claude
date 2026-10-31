/**
 * Tatiana (gerente comercial) nas telas da equipe: recado do dia, tarefas de hoje e acertos no
 * app (aba Follow-ups e Início), e o histórico de cobranças e o teste da noite (só admin, na tela
 * da Tatiana). A pessoa vê só o que é dela; o admin vê tudo. Nada é enviado a clientes.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import {
  COBRANCA,
  dataHoraCurta,
  semanaPorPessoa,
  type AcaoCobranca,
  type TipoCobranca,
} from "@/lib/comercial/tatiana";

type Db = SupabaseClient;

const UUID = /^[0-9a-f-]{36}$/i;
const uuid = (v: unknown, nome: string) => {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new Error(`${nome} inválido.`);
  return s;
};

/** Nomes das pessoas da empresa (pelo servidor: o app não lê os usuários). */
async function nomesDaEmpresa(empresaId: string): Promise<Map<string, string>> {
  const { pessoasDaEmpresa } = await import("@/lib/comercial/noite.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ps = await pessoasDaEmpresa(supabaseAdmin as unknown as Db, empresaId);
  return new Map(ps.map((p) => [p.userId, p.nome || "Sem nome"]));
}

/** Nome para o detalhe "resolvida por" (sem nome no cadastro: não mostra). */
function nomeOuNada(nomes: Map<string, string>, id: string | null): string | null {
  const n = id ? nomes.get(id) : undefined;
  return n && n !== "Sem nome" ? n : null;
}

const fimDeHojeSP = () => {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return { hoje, fim: new Date(`${hoje}T23:59:59-03:00`).toISOString() };
};

export type TarefaHoje = {
  id: string;
  leadId: string | null;
  leadNome: string;
  telefoneFinal: string | null;
  conversaId: string | null;
  quando: string;
  prioridade: number | null;
  motivo: string | null;
  mensagem: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  /** Cliente escreveu nas últimas 24 h: dá para mandar texto livre pelas Conversas. */
  dentroDaJanela: boolean;
};

export type TarefaAlice = {
  leadId: string;
  leadNome: string;
  telefoneFinal: string | null;
  quando: string | null;
  acao: string;
  mensagem: string | null;
  motivo: string | null;
  padraoFaria: string | null;
};

export type Acerto = {
  id: string;
  tipo: TipoCobranca;
  rotulo: string;
  botao: string;
  acao: AcaoCobranca;
  texto: string;
  leadId: string;
  leadNome: string;
  telefoneFinal: string | null;
  osNumero: string | null;
  responsavelNome: string | null;
  anuncio: boolean;
  criadaEm: string;
};

export type HojeTatiana = {
  modo: "desligado" | "teste" | "ativo";
  admin: boolean;
  /** Equipe única: lista e recado da equipe, sem separar por pessoa. */
  equipeUnica: boolean;
  recado: { frase: string; resumo: string | null } | null;
  tarefas: TarefaHoje[];
  alice: TarefaAlice[];
  acertos: Acerto[];
  pessoas: Array<{ id: string; nome: string }>;
};

export const hojeTatianaFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<HojeTatiana> => {
    const db = context.supabase as unknown as Db;
    const emp = context.empresaId as string;
    const eu = context.userId as string;
    const { data: papel } = await db.rpc("meu_papel");
    const admin = papel === "admin";
    const { hoje, fim } = fimDeHojeSP();
    // Configuração e cobranças pelo servidor (a configuração só o admin lê pelo app).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adm = supabaseAdmin as unknown as Db;
    const { data: cfg } = await adm
      .from("comercial_configuracoes")
      .select("ligado, modo, equipe_unica")
      .eq("empresa_id", emp)
      .maybeSingle();
    const c = cfg as {
      ligado: boolean;
      modo: HojeTatiana["modo"];
      equipe_unica: boolean | null;
    } | null;
    const modo: HojeTatiana["modo"] = c?.ligado ? c.modo : "desligado";
    const equipeUnica = Boolean(c?.equipe_unica);
    // Equipe única: a atendente vê a lista inteira da equipe (como o admin).
    const veTudo = admin || equipeUnica;
    const vazio: HojeTatiana = {
      modo,
      admin,
      equipeUnica,
      recado: null,
      tarefas: [],
      alice: [],
      acertos: [],
      pessoas: [],
    };
    if (modo === "desligado") return vazio;

    let qTarefas = db
      .from("crm_followups")
      .select(
        "id, crm_lead_id, conversa_id, scheduled_at, prioridade, motivo, mensagem, assigned_to",
      )
      .eq("empresa_id", emp)
      .eq("origem", "gerente")
      .eq("status", "Pendente")
      .lte("scheduled_at", fim)
      .order("prioridade", { ascending: true, nullsFirst: false })
      .order("scheduled_at")
      .limit(200);
    if (!veTudo) qTarefas = qTarefas.eq("assigned_to", eu);
    const [{ data: recado }, { data: tarefas }, { data: cobr }, { data: noite }] =
      await Promise.all([
        db
          .from("comercial_recados")
          .select("frase, resumo")
          .eq("empresa_id", emp)
          .eq("user_id", eu)
          .eq("dia", hoje)
          .maybeSingle(),
        qTarefas,
        db
          .from("comercial_cobrancas")
          .select("id, tipo, texto, crm_lead_id, user_id, anuncio, criada_em")
          .eq("empresa_id", emp)
          .eq("situacao", "pendente")
          .order("criada_em", { ascending: false })
          .limit(200),
        admin
          ? db
              .from("comercial_noites")
              .select("id")
              .eq("empresa_id", emp)
              .neq("modo", "conferencia")
              .order("iniciada_em", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
    const ts = (tarefas ?? []) as Array<{
      id: string;
      crm_lead_id: string | null;
      conversa_id: string | null;
      scheduled_at: string;
      prioridade: number | null;
      motivo: string | null;
      mensagem: string | null;
      assigned_to: string | null;
    }>;
    const cs = (
      (cobr ?? []) as Array<{
        id: string;
        tipo: TipoCobranca;
        texto: string;
        crm_lead_id: string;
        user_id: string | null;
        anuncio: boolean;
        criada_em: string;
      }>
    ).filter((x) => veTudo || x.user_id === eu);
    let alice: Array<{
      crm_lead_id: string;
      quando: string | null;
      acao: string;
      mensagem: string | null;
      motivo: string | null;
      padrao_faria: string | null;
    }> = [];
    if (admin && noite) {
      const { data: decs } = await db
        .from("comercial_decisoes")
        .select("crm_lead_id, quando, acao, mensagem, motivo, padrao_faria")
        .eq("noite_id", (noite as { id: string }).id)
        .eq("responsavel", "alice")
        .in("acao", ["chamar", "agendar"])
        .limit(200);
      alice = (decs ?? []) as typeof alice;
    }
    const leadIds = [
      ...new Set([
        ...ts.map((t) => t.crm_lead_id).filter(Boolean),
        ...cs.map((x) => x.crm_lead_id),
        ...alice.map((a) => a.crm_lead_id),
      ] as string[]),
    ];
    const { data: leads } = leadIds.length
      ? await db
          .from("crm_leads")
          .select("id, lead_name, normalized_phone, linked_work_order_id")
          .in("id", leadIds)
      : { data: [] };
    const ls = new Map(
      (
        (leads ?? []) as Array<{
          id: string;
          lead_name: string | null;
          normalized_phone: string | null;
          linked_work_order_id: string | null;
        }>
      ).map((l) => [l.id, l]),
    );
    const osIds = [...ls.values()].map((l) => l.linked_work_order_id).filter(Boolean) as string[];
    const { data: oss } = osIds.length
      ? await db.from("work_orders").select("id, os_number").in("id", osIds)
      : { data: [] };
    const numeroOs = new Map(
      ((oss ?? []) as Array<{ id: string; os_number: string | number | null }>).map((o) => [
        o.id,
        o.os_number === null ? null : String(o.os_number),
      ]),
    );
    // Janela de 24 h: última mensagem do cliente na conversa da tarefa.
    const convIds = ts.map((t) => t.conversa_id).filter(Boolean) as string[];
    const janela = new Set<string>();
    if (convIds.length) {
      const desde = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const { data: rec } = await db
        .from("whatsapp_messages")
        .select("conversa_id")
        .in("conversa_id", convIds)
        .eq("direction", "Recebida")
        .gte("message_timestamp", desde)
        .limit(500);
      for (const r of (rec ?? []) as Array<{ conversa_id: string }>) janela.add(r.conversa_id);
    }
    const nomes = await nomesDaEmpresa(emp);
    const nomeLead = (id: string | null) => (id && ls.get(id)?.lead_name) || "Cliente";
    const finalLead = (id: string | null) => {
      const t = id ? ls.get(id)?.normalized_phone : null;
      return t ? t.slice(-4) : null;
    };
    return {
      modo,
      admin,
      equipeUnica,
      recado: recado as HojeTatiana["recado"],
      tarefas: ts.map((t) => ({
        id: t.id,
        leadId: t.crm_lead_id,
        leadNome: nomeLead(t.crm_lead_id),
        telefoneFinal: finalLead(t.crm_lead_id),
        conversaId: t.conversa_id,
        quando: t.scheduled_at,
        prioridade: t.prioridade,
        motivo: t.motivo,
        mensagem: t.mensagem,
        responsavelId: t.assigned_to,
        responsavelNome: !equipeUnica && t.assigned_to ? (nomes.get(t.assigned_to) ?? null) : null,
        dentroDaJanela: Boolean(t.conversa_id && janela.has(t.conversa_id)),
      })),
      alice: alice.map((a) => ({
        leadId: a.crm_lead_id,
        leadNome: nomeLead(a.crm_lead_id),
        telefoneFinal: finalLead(a.crm_lead_id),
        quando: a.quando,
        acao: a.acao,
        mensagem: a.mensagem,
        motivo: a.motivo,
        padraoFaria: a.padrao_faria,
      })),
      acertos: cs.map((x) => {
        const l = ls.get(x.crm_lead_id);
        return {
          id: x.id,
          tipo: x.tipo,
          rotulo: COBRANCA[x.tipo].rotulo,
          botao: COBRANCA[x.tipo].botao,
          acao: COBRANCA[x.tipo].acao,
          texto: x.texto,
          leadId: x.crm_lead_id,
          leadNome: l?.lead_name || "Cliente",
          telefoneFinal: l?.normalized_phone ? l.normalized_phone.slice(-4) : null,
          osNumero: l?.linked_work_order_id ? (numeroOs.get(l.linked_work_order_id) ?? null) : null,
          responsavelNome: !equipeUnica && x.user_id ? (nomes.get(x.user_id) ?? null) : null,
          anuncio: x.anuncio,
          criadaEm: x.criada_em,
        };
      }),
      pessoas:
        admin && !equipeUnica ? [...nomes.entries()].map(([id, nome]) => ({ id, nome })) : [],
    };
  });

export const concluirTarefaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((d: { id: string }) => ({ id: uuid(d.id, "Tarefa") }))
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as Db;
    const { error } = await db
      .from("crm_followups")
      .update({
        status: "Concluída",
        completed_at: new Date().toISOString(),
        result: "Feito",
        concluida_por: context.userId as string,
      })
      .eq("id", data.id)
      .eq("origem", "gerente")
      .eq("status", "Pendente");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const pularTarefaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((d: { id: string; motivo?: string | null }) => ({
    id: uuid(d.id, "Tarefa"),
    motivo:
      String(d.motivo ?? "")
        .trim()
        .slice(0, 300) || null,
  }))
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as Db;
    const { error } = await db
      .from("crm_followups")
      .update({
        status: "Cancelada",
        pulado_motivo: data.motivo,
        result: "Pulada",
        completed_at: new Date().toISOString(),
        concluida_por: context.userId as string,
      })
      .eq("id", data.id)
      .eq("origem", "gerente")
      .eq("status", "Pendente");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resolverAcertoFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((d: { id: string; situacao: string; motivo?: string | null }) => {
    if (!["resolvida", "ja_certo"].includes(d.situacao)) throw new Error("Situação inválida.");
    return {
      id: uuid(d.id, "Acerto"),
      situacao: d.situacao,
      motivo:
        String(d.motivo ?? "")
          .trim()
          .slice(0, 300) || null,
    };
  })
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as Db;
    const { error } = await db.rpc("comercial_resolver_cobranca", {
      _id: data.id,
      _situacao: data.situacao,
      _motivo: data.motivo,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Itens lidos na conversa (para abrir o orçamento novo já sugerido). */
export const itensDoAcertoFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((d: { id: string }) => ({ id: uuid(d.id, "Acerto") }))
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as Db;
    const { data: c } = await db
      .from("comercial_cobrancas")
      .select("dados")
      .eq("id", data.id)
      .maybeSingle();
    const itens = (
      ((c as { dados?: { itens?: unknown } } | null)?.dados?.itens ?? []) as Array<{
        descricao?: string;
        quantidade?: number;
        valor?: number | null;
      }>
    )
      .filter((i) => i.descricao)
      .map((i) => ({
        descricao: String(i.descricao).slice(0, 120),
        quantidade: Number(i.quantidade) > 0 ? Number(i.quantidade) : 1,
        valor: i.valor === null || i.valor === undefined ? null : Number(i.valor),
      }));
    return { itens };
  });

/** Contagens rápidas: cartão do Início e selo do menu. */
export const contagemTatianaFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }) => {
    const db = context.supabase as unknown as Db;
    const { data: papel } = await db.rpc("meu_papel");
    const admin = papel === "admin";
    const { fim } = fimDeHojeSP();
    let q = db
      .from("crm_followups")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", context.empresaId as string)
      .eq("origem", "gerente")
      .eq("status", "Pendente")
      .lte("scheduled_at", fim);
    if (!admin) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: cfg } = await (supabaseAdmin as unknown as Db)
        .from("comercial_configuracoes")
        .select("equipe_unica")
        .eq("empresa_id", context.empresaId as string)
        .maybeSingle();
      if (!(cfg as { equipe_unica?: boolean } | null)?.equipe_unica)
        q = q.eq("assigned_to", context.userId as string);
    }
    const [{ count: tarefas }, antigas] = await Promise.all([
      q,
      admin
        ? db
            .from("comercial_cobrancas")
            .select("id", { count: "exact", head: true })
            .eq("empresa_id", context.empresaId as string)
            .eq("situacao", "pendente")
            .lt("criada_em", new Date(Date.now() - 2 * 86_400_000).toISOString())
        : Promise.resolve({ count: 0 }),
    ]);
    return { tarefas: tarefas ?? 0, cobrancasAntigas: antigas.count ?? 0 };
  });

// ---------------------------------------------------------------- cobranças (só admin)

export type LinhaCobranca = {
  id: string;
  criadaEm: string;
  pessoa: string | null;
  pessoaId: string | null;
  tipo: TipoCobranca;
  rotulo: string;
  texto: string;
  leadId: string;
  telefoneFinal: string | null;
  situacao: "pendente" | "resolvida" | "ja_certo";
  horasParaResolver: number | null;
  /** Quem resolveu (só detalhe da linha). */
  resolvidaPor: string | null;
  motivo: string | null;
  anuncio: boolean;
};

export type ResumoNoite = {
  porTipo?: Record<string, number>;
  porPessoa?: Record<string, number>;
  caixinhas?: Record<string, number>;
  leads?: number;
};

export type PainelCobrancas = {
  /** Equipe única: totais da equipe, sem separar por pessoa. */
  equipeUnica: boolean;
  linhas: LinhaCobranca[];
  semana: Array<{
    pessoa: string;
    semana: number;
    anterior: number;
    resolvidas: number;
    pendentes: number;
    horasMedias: number | null;
    primeiraRespostaMin: number | null;
    precoMin: number | null;
  }>;
  noites: Array<{
    noite: string;
    modo: string;
    leads: number;
    status: string;
    custoUsd: number;
    resumo: ResumoNoite;
  }>;
  gastoMesUsd: number;
  tetoMensalUsd: number;
  comparacao: Array<{
    leadId: string;
    telefoneFinal: string | null;
    padrao: string | null;
    decidiu: string;
    responsavel: string | null;
  }>;
};

export const cobrancasTatianaFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<PainelCobrancas> => {
    const db = context.supabase as unknown as Db;
    const emp = context.empresaId as string;
    const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const mes = new Date()
      .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
      .slice(0, 7);
    const [{ data: cobr }, { data: noites }, { data: cfg }] = await Promise.all([
      db
        .from("comercial_cobrancas")
        .select(
          "id, criada_em, user_id, tipo, texto, crm_lead_id, situacao, resolvida_em, resolvida_por, motivo, anuncio",
        )
        .eq("empresa_id", emp)
        .gte("criada_em", desde)
        .order("criada_em", { ascending: false })
        .limit(2000),
      db
        .from("comercial_noites")
        .select("id, noite, modo, leads, status, custo_usd, resumo")
        .eq("empresa_id", emp)
        .order("iniciada_em", { ascending: false })
        .limit(40),
      db
        .from("comercial_configuracoes")
        .select("teto_mensal_usd, equipe_unica")
        .eq("empresa_id", emp)
        .maybeSingle(),
    ]);
    const cs = (cobr ?? []) as Array<{
      id: string;
      criada_em: string;
      user_id: string | null;
      tipo: TipoCobranca;
      texto: string;
      crm_lead_id: string;
      situacao: LinhaCobranca["situacao"];
      resolvida_em: string | null;
      resolvida_por: string | null;
      motivo: string | null;
      anuncio: boolean;
    }>;
    const equipeUnica = Boolean((cfg as { equipe_unica?: boolean } | null)?.equipe_unica);
    const ns = (noites ?? []) as Array<{
      id: string;
      noite: string;
      modo: string;
      leads: string[];
      status: string;
      custo_usd: number | string;
      resumo: ResumoNoite | null;
    }>;
    const ultima = ns.find((n) => n.modo !== "conferencia");
    const { data: decs } = ultima
      ? await db
          .from("comercial_decisoes")
          .select("crm_lead_id, acao, quando, responsavel, padrao_faria, motivo")
          .eq("noite_id", ultima.id)
          .limit(500)
      : { data: [] };
    const ds = (decs ?? []) as Array<{
      crm_lead_id: string;
      acao: string;
      quando: string | null;
      responsavel: string | null;
      padrao_faria: string | null;
      motivo: string | null;
    }>;
    const leadIds = [
      ...new Set([...cs.map((c) => c.crm_lead_id), ...ds.map((d) => d.crm_lead_id)]),
    ];
    const finais = new Map<string, string | null>();
    for (let i = 0; i < leadIds.length; i += 300) {
      const { data: ls } = await db
        .from("crm_leads")
        .select("id, normalized_phone")
        .in("id", leadIds.slice(i, i + 300));
      for (const l of (ls ?? []) as Array<{ id: string; normalized_phone: string | null }>)
        finais.set(l.id, l.normalized_phone ? l.normalized_phone.slice(-4) : null);
    }
    const nomes = await nomesDaEmpresa(emp);
    // Tempo médio de 1ª resposta e até o preço (últimos 7 dias), por dono da conversa.
    const { data: convs } = await db
      .from("conversas")
      .select("crm_lead_id, assumida_por, criada_em, primeira_resposta_em")
      .eq("empresa_id", emp)
      .gte("criada_em", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .limit(1000);
    const tempos = new Map<string, { resp: number[]; preco: number[] }>();
    const leadsSemana = (
      (convs ?? []) as Array<{
        crm_lead_id: string | null;
        assumida_por: string | null;
        criada_em: string | null;
        primeira_resposta_em: string | null;
      }>
    ).filter((c) => c.assumida_por);
    const idsSemana = leadsSemana.map((c) => c.crm_lead_id).filter(Boolean) as string[];
    const { data: precos } = idsSemana.length
      ? await db
          .from("crm_leads")
          .select("id, primeira_mensagem_em, orcamento_enviado_em")
          .in("id", idsSemana)
      : { data: [] };
    const precoDo = new Map(
      (
        (precos ?? []) as Array<{
          id: string;
          primeira_mensagem_em: string | null;
          orcamento_enviado_em: string | null;
        }>
      ).map((p) => [p.id, p]),
    );
    // Equipe única: os tempos médios são os da equipe toda (chave "").
    const chaveTempo = (u: string) => (equipeUnica ? "" : u);
    for (const c of leadsSemana) {
      const t = tempos.get(chaveTempo(c.assumida_por!)) ?? { resp: [], preco: [] };
      if (c.criada_em && c.primeira_resposta_em)
        t.resp.push((Date.parse(c.primeira_resposta_em) - Date.parse(c.criada_em)) / 60_000);
      const p = c.crm_lead_id ? precoDo.get(c.crm_lead_id) : null;
      if (p?.primeira_mensagem_em && p.orcamento_enviado_em)
        t.preco.push(
          (Date.parse(p.orcamento_enviado_em) - Date.parse(p.primeira_mensagem_em)) / 60_000,
        );
      tempos.set(chaveTempo(c.assumida_por!), t);
    }
    const media = (xs: number[]) =>
      xs.length
        ? Math.round(xs.filter((x) => x >= 0).reduce((a, b) => a + b, 0) / xs.length)
        : null;
    const semana = semanaPorPessoa(
      cs.map((c) => ({
        userId: equipeUnica ? null : c.user_id,
        situacao: c.situacao,
        criadaEm: c.criada_em,
        resolvidaEm: c.resolvida_em,
      })),
    ).map((s) => ({
      pessoa: equipeUnica ? "Equipe" : s.userId ? (nomes.get(s.userId) ?? "Sem nome") : "Sem dono",
      semana: s.semana,
      anterior: s.anterior,
      resolvidas: s.resolvidas,
      pendentes: s.pendentes,
      horasMedias: s.horasMedias,
      primeiraRespostaMin:
        equipeUnica || s.userId ? media(tempos.get(s.userId ?? "")?.resp ?? []) : null,
      precoMin: equipeUnica || s.userId ? media(tempos.get(s.userId ?? "")?.preco ?? []) : null,
    }));
    const gastoMes = ns
      .filter((n) => n.noite.startsWith(mes))
      .reduce((s, n) => s + Number(n.custo_usd ?? 0), 0);
    return {
      equipeUnica,
      linhas: cs.map((c) => ({
        id: c.id,
        criadaEm: c.criada_em,
        pessoa: equipeUnica ? null : c.user_id ? (nomes.get(c.user_id) ?? "Sem nome") : null,
        pessoaId: equipeUnica ? null : c.user_id,
        tipo: c.tipo,
        rotulo: COBRANCA[c.tipo].rotulo,
        texto: c.texto,
        leadId: c.crm_lead_id,
        telefoneFinal: finais.get(c.crm_lead_id) ?? null,
        situacao: c.situacao,
        horasParaResolver: c.resolvida_em
          ? Math.round((Date.parse(c.resolvida_em) - Date.parse(c.criada_em)) / 3_600_000)
          : null,
        resolvidaPor: nomeOuNada(nomes, c.resolvida_por),
        motivo: c.motivo,
        anuncio: c.anuncio,
      })),
      semana,
      noites: ns.map((n) => ({
        noite: n.noite,
        modo: n.modo,
        leads: n.leads.length,
        status: n.status,
        custoUsd: Number(n.custo_usd),
        resumo: n.resumo ?? {},
      })),
      gastoMesUsd: gastoMes,
      tetoMensalUsd: Number(
        (cfg as { teto_mensal_usd?: number | string } | null)?.teto_mensal_usd ?? 0,
      ),
      comparacao: ds.map((d) => ({
        leadId: d.crm_lead_id,
        telefoneFinal: finais.get(d.crm_lead_id) ?? null,
        padrao: d.padrao_faria,
        decidiu: `${d.acao}${d.quando ? ` (${dataHoraCurta(d.quando)})` : ""}${d.motivo ? `: ${d.motivo}` : ""}`,
        responsavel: d.responsavel,
      })),
    };
  });
