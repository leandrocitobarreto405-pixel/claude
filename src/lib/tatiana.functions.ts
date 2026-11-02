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
import { horarioDaConfig, textoLeadSite, tipoTarefa, type TipoTarefa } from "@/lib/comercial/furos";
import type { MesTatiana as MesTatianaTela } from "@/lib/comercial/mes.server";
import type { PlanoTatiana } from "@/lib/comercial/plano.server";
import type { SemanaEquipe } from "@/lib/comercial/equipe";
import { requireRecurso } from "@/lib/recurso.middleware";
import {
  JANELA_DIAS,
  resumoDasClasses,
  type ClasseResposta,
  type NumerosCampanha,
  type Sugestao,
} from "@/lib/comercial/campanhas";

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
  /** Tipo da tarefa (ligar, follow-up esquecido, remarcar, pós-venda, lead do site). */
  tipo: TipoTarefa;
  /** Quantas vezes a tarefa voltou sem Feito/Pular ("pendente de ontem"). */
  adiamentos: number;
  /** Telefone inteiro (só para ligar e lead do site). */
  telefone: string | null;
  /** Lead do site sem conversa (tarefa virtual, resolvida no Precisa de você). */
  leadSiteId: string | null;
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

/** Lead do site sem conversa (item 8): tarefa virtual para a equipe (ligar ou mandar o modelo). */
async function tarefasLeadSite(db: Db, emp: string, hoje: string): Promise<TarefaHoje[]> {
  const { leadsSiteParaTarefa } = await import("@/lib/comercial/noite.server");
  return (await leadsSiteParaTarefa(db, emp, hoje)).map((l) => {
    const t = textoLeadSite({
      nome: (l.nome ?? "").split(" ")[0] ?? "",
      servico: l.servico,
      lp: l.lp,
    });
    return {
      id: `site:${l.id}`,
      leadId: null,
      leadNome: l.nome?.trim() || "Lead do site",
      telefoneFinal: l.telefone ? l.telefone.slice(-4) : null,
      conversaId: null,
      quando: `${hoje}T09:00:00-03:00`,
      prioridade: 2,
      motivo: t.motivo,
      mensagem: t.mensagem,
      responsavelId: null,
      responsavelNome: null,
      dentroDaJanela: false,
      tipo: "lead_site" as const,
      adiamentos: 0,
      telefone: l.telefone,
      leadSiteId: l.id,
    };
  });
}

/** Feriado dos próximos dias ainda sem decisão (só o admin vê; botões em Tatiana › Hoje). */
export type FeriadoPendente = { id: string; data: string; nome: string; diasAte: number };

export type HojeTatiana = {
  modo: "desligado" | "teste" | "ativo";
  admin: boolean;
  /** Feriados para decidir "vamos trabalhar?" (02/11). */
  feriados: FeriadoPendente[];
  /** Equipe única: lista e recado da equipe, sem separar por pessoa. */
  equipeUnica: boolean;
  recado: { frase: string; resumo: string | null } | null;
  /** Números da semana da equipe toda (nunca por pessoa). */
  semana: SemanaEquipe | null;
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
      .select("ligado, modo, equipe_unica, dias_uteis")
      .eq("empresa_id", emp)
      .maybeSingle();
    const c = cfg as {
      ligado: boolean;
      modo: HojeTatiana["modo"];
      equipe_unica: boolean | null;
      dias_uteis: number[] | null;
    } | null;
    const modo: HojeTatiana["modo"] = c?.ligado ? c.modo : "desligado";
    const equipeUnica = Boolean(c?.equipe_unica);
    // Equipe única: a atendente vê a lista inteira da equipe (como o admin).
    const veTudo = admin || equipeUnica;
    const vazio: HojeTatiana = {
      modo,
      admin,
      feriados: [],
      equipeUnica,
      recado: null,
      semana: null,
      tarefas: [],
      alice: [],
      acertos: [],
      pessoas: [],
    };
    if (modo === "desligado") return vazio;

    let qTarefas = db
      .from("crm_followups")
      .select(
        "id, crm_lead_id, conversa_id, scheduled_at, prioridade, motivo, mensagem, assigned_to, tarefa_tipo, adiamentos",
      )
      .eq("empresa_id", emp)
      .eq("origem", "gerente")
      .eq("responsavel", "equipe")
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
          // Lista da equipe: só os acertos escolhidos pela noite (até 10 por dia).
          .eq("visivel_equipe", true)
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
      tarefa_tipo: string | null;
      adiamentos: number | null;
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
    // Semana da equipe: totais da empresa (pelo servidor), iguais para todo mundo.
    const semana = await (async () => {
      const { semanaDaEquipe } = await import("@/lib/comercial/equipe.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return semanaDaEquipe(supabaseAdmin as unknown as Db, emp, hoje);
    })().catch(() => null);
    const nomeLead = (id: string | null) => (id && ls.get(id)?.lead_name) || "Cliente";
    const finalLead = (id: string | null) => {
      const t = id ? ls.get(id)?.normalized_phone : null;
      return t ? t.slice(-4) : null;
    };
    // Feriados sem decisão nas próximas 3 semanas (admin decide com um toque).
    const feriados: FeriadoPendente[] = admin
      ? await (async () => {
          const { feriadosNoPeriodo } = await import("@/lib/feriados.server");
          const { DIAS_PERGUNTA, caiEmDiaUtil, diasEntre, somarDias } =
            await import("@/lib/feriados");
          const lista = await feriadosNoPeriodo(adm, emp, hoje, somarDias(hoje, DIAS_PERGUNTA));
          return lista
            .filter((f) => f.trabalhamos === null && caiEmDiaUtil(f.data, c?.dias_uteis))
            .map((f) => ({
              id: f.id,
              data: f.data,
              nome: f.nome,
              diasAte: diasEntre(hoje, f.data),
            }));
        })().catch(() => [])
      : [];
    return {
      modo,
      admin,
      feriados,
      equipeUnica,
      recado: recado as HojeTatiana["recado"],
      semana,
      tarefas: ts
        .map((t): TarefaHoje => ({
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
          responsavelNome:
            !equipeUnica && t.assigned_to ? (nomes.get(t.assigned_to) ?? null) : null,
          dentroDaJanela: Boolean(t.conversa_id && janela.has(t.conversa_id)),
          tipo: tipoTarefa(t.tarefa_tipo),
          adiamentos: t.adiamentos ?? 0,
          telefone:
            tipoTarefa(t.tarefa_tipo) === "ligar"
              ? (ls.get(t.crm_lead_id ?? "")?.normalized_phone ?? null)
              : null,
          leadSiteId: null,
        }))
        .concat(await tarefasLeadSite(db, emp, hoje)),
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
    /** Próxima olhada da Tatiana (dd/mm) ou null. */
    proximaOlhada: string | null;
  }>;
  /** Horário de atendimento (tarefas só em dia/hora útil). */
  horario: { dias: number[]; inicio: string; fim: string };
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
        .select("teto_mensal_usd, equipe_unica, dias_uteis, hora_inicio, hora_fim")
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
          .select("crm_lead_id, acao, quando, responsavel, padrao_faria, motivo, rever_em")
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
      rever_em: string | null;
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
        proximaOlhada: d.rever_em ? dataHoraCurta(d.rever_em).slice(0, 5) : null,
      })),
      horario: horarioDaConfig(cfg as never),
    };
  });

/** Horário de atendimento da empresa (só admin): dias da semana e horas das tarefas. */
export const salvarHorarioTatianaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((d: { dias: number[]; inicio: string; fim: string }) => {
    const dias = [...new Set((d.dias ?? []).map(Number))].filter((x) => x >= 0 && x <= 6).sort();
    if (!dias.length) throw new Error("Escolha pelo menos um dia da semana.");
    const hm = /^\d{2}:\d{2}$/;
    if (!hm.test(d.inicio) || !hm.test(d.fim) || d.inicio >= d.fim)
      throw new Error("O horário de início precisa ser antes do fim.");
    return { dias, inicio: d.inicio, fim: d.fim };
  })
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as Db;
    const { error } = await db.rpc("comercial_salvar_horario", {
      _dias: data.dias,
      _inicio: data.inicio,
      _fim: data.fim,
    });
    if (error) throw new Error(error.message || "Não foi possível salvar o horário.");
    return { ok: true };
  });

// ---------------------------------------------------------------- campanhas (admin)

export type CampanhaTela = {
  id: string;
  campanhaId: string;
  nome: string;
  tema: string | null;
  datas: string[];
  status: string;
  janelaInicio: string;
  janelaFim: string;
  /** Sugestões prontas (janela de 7 dias fechada). */
  encerrada: boolean;
  /** Dia da janela em que estamos (1–7); 7 quando fechada. */
  dia: number;
  numeros: NumerosCampanha;
  classes: Array<{ classe: ClasseResposta; nome: string; n: number }>;
  semTexto: number;
  sugestoes: Sugestao[];
  leitura: string | null;
  custoUsd: number;
  atualizadoEm: string;
};

/** Aba "Campanhas" da Tatiana: desempenho de cada campanha enviada (só admin). */
export const campanhasTatianaFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<CampanhaTela[]> => {
    const db = context.supabase as unknown as Db;
    const emp = context.empresaId as string;
    const { data, error } = await db
      .from("comercial_campanhas")
      .select(
        "id, campanha_id, janela_inicio, janela_fim, encerrada, numeros, respostas, sugestoes, leitura, custo_usd, atualizado_em, mkt_campanhas(nome, tema, datas_disparo, status)",
      )
      .eq("empresa_id", emp)
      .order("janela_inicio", { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);
    const agora = Date.now();
    return (
      (data ?? []) as unknown as Array<{
        id: string;
        campanha_id: string;
        janela_inicio: string;
        janela_fim: string;
        encerrada: boolean;
        numeros: NumerosCampanha | Record<string, never>;
        respostas: { por_envio?: Record<string, ClasseResposta>; sem_texto?: number } | null;
        sugestoes: Sugestao[] | null;
        leitura: string | null;
        custo_usd: number | string;
        atualizado_em: string;
        mkt_campanhas: {
          nome: string;
          tema: string | null;
          datas_disparo: string[] | null;
          status: string;
        } | null;
      }>
    )
      .filter((l) => "enviados" in l.numeros)
      .map((l) => ({
        id: l.id,
        campanhaId: l.campanha_id,
        nome: l.mkt_campanhas?.nome ?? "Campanha",
        tema: l.mkt_campanhas?.tema ?? null,
        datas: l.mkt_campanhas?.datas_disparo ?? [],
        status: l.mkt_campanhas?.status ?? "",
        janelaInicio: l.janela_inicio,
        janelaFim: l.janela_fim,
        encerrada: l.encerrada,
        dia: Math.min(
          JANELA_DIAS,
          Math.max(1, Math.ceil((agora - Date.parse(l.janela_inicio)) / 86_400_000)),
        ),
        numeros: l.numeros as NumerosCampanha,
        classes: resumoDasClasses(l.respostas?.por_envio ?? {}),
        semTexto: Number(l.respostas?.sem_texto ?? 0),
        sugestoes: l.sugestoes ?? [],
        leitura: l.leitura,
        custoUsd: Number(l.custo_usd ?? 0),
        atualizadoEm: l.atualizado_em,
      }));
  });

// ---------------------------------------------------------------- gerente do mês (admin)

/** Aba "Mês" da Tatiana: meta diária, previsão, agenda até o fim do mês e alertas (só admin). */
export const mesTatianaFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<MesTatianaTela> => {
    const db = context.supabase as unknown as Db;
    const emp = context.empresaId as string;
    const { calcularMes } = await import("@/lib/comercial/mes.server");
    const { data: cfg } = await db
      .from("comercial_configuracoes")
      .select("dias_uteis")
      .eq("empresa_id", emp)
      .maybeSingle();
    const dias = (cfg as { dias_uteis?: number[] | null } | null)?.dias_uteis ?? [1, 2, 3, 4, 5, 6];
    return calcularMes(db, emp, fimDeHojeSP().hoje, dias);
  });

// ---------------------------------------------------------------- plano de ação (admin)

/** Plano de ação do dia (ou o mais recente) da Tatiana. */
export const planoTatianaFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<PlanoTatiana | null> => {
    const { planoAtual } = await import("@/lib/comercial/plano.server");
    return planoAtual(context.supabase as unknown as Db, context.empresaId as string);
  });

const comMarketing = requireRecurso("marketing");

/** Aprovar (cria o rascunho no Marketing) ou recusar uma ação do plano. Só admin. */
export const decidirAcaoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, comMarketing])
  .inputValidator(
    (input: {
      planoId: string;
      indice: number;
      decisao: "aprovar" | "recusar";
      motivo?: string;
    }) => ({
      planoId: uuid(input.planoId, "Plano"),
      indice: Math.max(0, Math.min(9, Math.round(Number(input.indice) || 0))),
      decisao: input.decisao === "aprovar" ? ("aprovar" as const) : ("recusar" as const),
      motivo: input.motivo ? String(input.motivo).slice(0, 300) : null,
    }),
  )
  .handler(async ({ data, context }): Promise<{ campanhaId: string | null }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as Db;
    const emp = context.empresaId as string;
    const userId = context.userId as string;
    const { aprovarAcao, recusarAcao } = await import("@/lib/comercial/plano.server");
    if (data.decisao === "recusar") {
      await recusarAcao(db, {
        empresaId: emp,
        userId,
        planoId: data.planoId,
        indice: data.indice,
        motivo: data.motivo,
      });
      return { campanhaId: null };
    }
    const agora = new Date().toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
    const r = await aprovarAcao(db, {
      empresaId: emp,
      userId,
      planoId: data.planoId,
      indice: data.indice,
      hoje: fimDeHojeSP().hoje,
      agora,
    });
    return { campanhaId: r.campanhaId };
  });
