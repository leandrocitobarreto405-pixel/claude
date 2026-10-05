/**
 * Funções das telas de marketing (Campanhas WhatsApp): situação, aprovação, edição, pausa,
 * importação, recálculo dos grupos, gatilhos de hoje e configuração.
 *
 * Leitura pela sessão do usuário (RLS da empresa ativa). Ações que mexem na fila chamam as funções
 * do banco com a chave de serviço, sempre depois de conferir que a campanha é da empresa ativa.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import {
  modelosAprovados,
  validarNovaCampanha,
  type EntradaNovaCampanha,
  type ModeloAprovado,
  type QuemResponde,
} from "@/lib/campanha-nova";

export const GRUPOS = ["C1", "C2", "C3", "C4", "C5", "N1", "N2", "N3"] as const;
export const NOMES_GRUPOS: Record<string, string> = {
  C1: "Pós-venda (dia seguinte)",
  C2: "Higienização há 5–7 meses",
  C3: "Impermeabilização no 13º mês",
  C4: "Compradores 3–12 meses",
  C5: "Compradores 12+ meses",
  N1: "Orçamento até 3 meses",
  N2: "Orçamento 3–9 meses",
  N3: "Orçamento 12+ meses",
};

const ID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

async function servico() {
  const { dbServico } = await import("@/lib/mkt/contexto.server");
  return dbServico();
}

/** Confere que a campanha é da empresa ativa (antes de usar a chave de serviço). */
async function campanhaDaEmpresa(empresaId: string, campanhaId: string) {
  if (!ID.test(campanhaId)) throw new Error("Campanha inválida.");
  const db = await servico();
  const { data } = await db
    .from("mkt_campanhas")
    .select("id, tipo, status, datas_disparo, nome, hora_inicio")
    .eq("id", campanhaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!data) throw new Error("Campanha não encontrada.");
  return { db, campanha: data };
}

/** "14:05": hora de agora em São Paulo. */
function horaSP() {
  return new Date().toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

async function diasDeDisparo(db: Awaited<ReturnType<typeof servico>>, empresaId: string) {
  const { data } = await db
    .from("mkt_configuracoes")
    .select("dias_disparo")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  return (data?.dias_disparo ?? [2, 3, 4]).map(Number);
}

// ---------------------------------------------------------------- situação
export const situacaoMarketing = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const emp = context.empresaId;
    const [cfg, campanhas, relatorio, lotes, avisos, papel, ...contagens] = await Promise.all([
      sb.from("mkt_configuracoes").select("*").eq("empresa_id", emp).maybeSingle(),
      sb
        .from("mkt_campanhas")
        .select(
          "id, nome, tipo, gatilho, mes_ref, tema, grupos, listas, templates, datas_disparo, limites, condicao_texto, condicao_pct, status, motivo_status, estimativa, custo_msg_estimado, aprovada_em, preparada_em, quem_responde, criada_por, hora_inicio",
        )
        .eq("empresa_id", emp)
        .order("mes_ref")
        .order("tipo"),
      sb.from("vw_mkt_campanhas_relatorio").select("*").eq("empresa_id", emp),
      sb.from("vw_mkt_lotes_relatorio").select("*").eq("empresa_id", emp).order("numero"),
      sb
        .from("mkt_avisos")
        .select("id, tipo, titulo, mensagem, campanha_id, created_at, lido_em")
        .eq("empresa_id", emp)
        .order("created_at", { ascending: false })
        .limit(30),
      sb.rpc("meu_papel" as never),
      sb.from("mkt_contatos").select("id", { count: "exact", head: true }).eq("empresa_id", emp),
      ...GRUPOS.map((g) =>
        sb
          .from("mkt_contatos")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", emp)
          .eq("grupo_atual", g),
      ),
      sb
        .from("mkt_contatos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", emp)
        .not("optout_em", "is", null),
    ]);
    const [total, ...porGrupo] = contagens;
    const optouts = porGrupo.pop();
    return {
      config: cfg.data,
      campanhas: campanhas.data ?? [],
      relatorio: relatorio.data ?? [],
      lotes: lotes.data ?? [],
      avisos: avisos.data ?? [],
      admin: (papel.data as unknown as string) === "admin",
      base: {
        total: total?.count ?? 0,
        optouts: optouts?.count ?? 0,
        grupos: Object.fromEntries(GRUPOS.map((g, i) => [g, porGrupo[i]?.count ?? 0])),
      },
    };
  });

/** Modelos na Meta e prévia com 3 contatos reais (lê o Chatwoot). */
export const conferirCampanhaFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((input: { campanhaId: string }) => ({ campanhaId: String(input.campanhaId) }))
  .handler(async ({ data, context }) => {
    const { db } = await campanhaDaEmpresa(context.empresaId, data.campanhaId);
    const { conferirCampanha } = await import("@/lib/mkt/campanhas.server");
    return conferirCampanha(db, data.campanhaId);
  });

/** Quantos estão em cada lista da campanha e quantos podem receber agora. */
export const contagemCampanhaFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((input: { campanhaId: string }) => ({ campanhaId: String(input.campanhaId) }))
  .handler(async ({ data, context }) => {
    if (!ID.test(data.campanhaId)) throw new Error("Campanha inválida.");
    const { data: r, error } = await context.supabase.rpc(
      "mkt_campanha_contagem" as never,
      { _campanha: data.campanhaId } as never,
    );
    if (error) throw new Error(`Não foi possível contar as listas: ${error.message}`);
    return (r ?? []) as unknown as Array<{ grupo: string; total: number; podem: number }>;
  });

// ---------------------------------------------------------------- lembretes com aprovação
export type LembretesParaAprovar = {
  admin: boolean;
  lotes: Array<{
    id: string;
    campanhaId: string;
    gatilho: string | null;
    titulo: string;
    data: string;
    quantidade: number;
    /** Ficaram para depois: receberam campanha ou promoção há menos de 30 dias. */
    adiados: number;
    previa: Array<{ nome: string | null; texto: string | null; erro: string | null }>;
    problemas: string[];
  }>;
};

const TITULO_LEMBRETE: Record<string, string> = {
  C2: "Higienização (6 meses)",
  C3: "Impermeabilização (13º mês)",
  C3L: "Segundo lembrete da impermeabilização",
};

/** Lotes de lembretes do dia esperando aprovação, com a quantidade e uma prévia real. */
export const lembretesParaAprovarFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<LembretesParaAprovar> => {
    const [{ data: papel }, { data: lotes, error }] = await Promise.all([
      context.supabase.rpc("meu_papel" as never),
      context.supabase
        .from("mkt_lotes")
        .select("id, campanha_id, data_prevista, adiados, mkt_campanhas!inner ( gatilho, tipo )")
        .eq("empresa_id", context.empresaId)
        .eq("status", "aguardando_aprovacao")
        .order("data_prevista")
        .limit(10),
    ]);
    if (error) throw new Error(`Não foi possível ler os lembretes: ${error.message}`);
    const lista = (lotes ?? []) as unknown as Array<{
      id: string;
      campanha_id: string;
      data_prevista: string;
      adiados: number | null;
      mkt_campanhas: { gatilho: string | null; tipo: string };
    }>;
    if (!lista.length) return { admin: (papel as unknown as string) === "admin", lotes: [] };
    const db = await servico();
    const { conferirCampanha } = await import("@/lib/mkt/campanhas.server");
    const resultado: LembretesParaAprovar["lotes"] = [];
    for (const l of lista) {
      const { count } = await db
        .from("mkt_envios")
        .select("id", { count: "exact", head: true })
        .eq("lote_id", l.id)
        .eq("status", "pendente");
      const conf = await conferirCampanha(db, l.campanha_id, undefined, l.id).catch((e) => ({
        previa: [],
        problemas: [e instanceof Error ? e.message : String(e)],
      }));
      const g = l.mkt_campanhas.gatilho;
      resultado.push({
        id: l.id,
        campanhaId: l.campanha_id,
        gatilho: g,
        titulo: TITULO_LEMBRETE[g ?? ""] ?? "Lembretes",
        data: l.data_prevista,
        quantidade: count ?? 0,
        adiados: l.adiados ?? 0,
        previa: conf.previa.map((p) => ({ nome: p.nome, texto: p.texto, erro: p.erro })),
        problemas: conf.problemas,
      });
    }
    return { admin: (papel as unknown as string) === "admin", lotes: resultado };
  });

/** Aprovar ou não enviar o lote de lembretes (só admin). */
export const decidirLembretesFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { loteId: string; aprovar: boolean }) => {
    if (!ID.test(String(input.loteId))) throw new Error("Lote inválido.");
    return { loteId: String(input.loteId), aprovar: Boolean(input.aprovar) };
  })
  .handler(async ({ data, context }) => {
    const db = await servico();
    const { data: lote } = await db
      .from("mkt_lotes")
      .select("id")
      .eq("id", data.loteId)
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (!lote) throw new Error("Lote não encontrado.");
    const { data: r, error } = await db.rpc(
      "mkt_decidir_lembretes" as never,
      { _lote: data.loteId, _aprovar: data.aprovar, _usuario: context.userId } as never,
    );
    if (error) throw new Error(error.message);
    return r as unknown as { envios: number; aprovado: boolean };
  });

// ---------------------------------------------------------------- aprovação
export const prepararCampanhaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { campanhaId: string }) => ({ campanhaId: String(input.campanhaId) }))
  .handler(async ({ data, context }) => {
    const { db, campanha } = await campanhaDaEmpresa(context.empresaId, data.campanhaId);
    if (campanha.tipo !== "calendario") throw new Error("Só campanhas do calendário.");
    const { prepararCampanha } = await import("@/lib/mkt/campanhas.server");
    return prepararCampanha(db, data.campanhaId);
  });

/** Nova campanha (só admin). Nasce em rascunho e segue o fluxo normal: preparar, conferir, aprovar. */
export const criarCampanhaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: EntradaNovaCampanha) => ({
    nome: String(input.nome ?? "").slice(0, 200),
    listas: (Array.isArray(input.listas) ? input.listas : []).slice(0, 10).map((l) => ({
      grupo: String(l?.grupo ?? "").slice(0, 10),
      modelo: String(l?.modelo ?? "").slice(0, 200),
      faixa: l?.faixa ? String(l.faixa).slice(0, 10) : undefined,
      quantidade:
        l?.quantidade === null || l?.quantidade === undefined ? null : Number(l.quantidade),
    })),
    semCondicao: Boolean(input.semCondicao),
    condicaoTexto: input.condicaoTexto ? String(input.condicaoTexto).slice(0, 300) : null,
    condicaoPct:
      input.condicaoPct === null || input.condicaoPct === undefined
        ? null
        : Number(input.condicaoPct),
    datas: (Array.isArray(input.datas) ? input.datas : []).slice(0, 30).map(String),
    horaInicio: input.horaInicio ? String(input.horaInicio).slice(0, 5) : null,
    quemResponde: (input.quemResponde === "equipe" ? "equipe" : "alice") as QuemResponde,
  }))
  .handler(async ({ data, context }) => {
    const db = await servico();
    const { hojeSP } = await import("@/lib/mkt/campanhas.server");
    const { data: cfg } = await db
      .from("mkt_configuracoes")
      .select("dias_disparo, custo_msg_estimado")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    const r = validarNovaCampanha(data, {
      hoje: hojeSP(),
      dias: (cfg?.dias_disparo ?? [2, 3, 4]).map(Number),
      agora: horaSP(),
    });
    if (!r.ok) throw new Error(r.problemas.join(" "));
    const c = r.campanha;
    const { data: nova, error } = await db
      .from("mkt_campanhas")
      .insert({
        empresa_id: context.empresaId,
        nome: c.nome,
        tipo: "calendario",
        mes_ref: c.mesRef,
        grupos: c.listas.map((l) => l.grupo),
        listas: c.listas,
        templates: c.templates,
        datas_disparo: c.datas,
        condicao_texto: c.condicaoTexto,
        condicao_pct: c.condicaoPct,
        custo_msg_estimado: cfg?.custo_msg_estimado ?? 0.32,
        quem_responde: c.quemResponde,
        limites: c.limites,
        hora_inicio: c.horaInicio,
        criada_por: context.userId,
        status: "rascunho",
      })
      .select("id")
      .single();
    if (error || !nova) throw new Error("Não foi possível criar a campanha.");
    return { id: nova.id as string };
  });

/** Modelos aprovados na Meta para escolher na campanha nova, com o texto para a prévia. */
export const modelosAprovadosFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(
    async ({
      context,
    }): Promise<{ fonte: string; erro: string | null; modelos: ModeloAprovado[] }> => {
      const db = await servico();
      const [{ listarParaTela }, { data: cfg }] = await Promise.all([
        import("@/lib/meta/modelos.server"),
        db
          .from("mkt_configuracoes")
          .select("template_idioma")
          .eq("empresa_id", context.empresaId)
          .maybeSingle(),
      ]);
      const lista = await listarParaTela(db, context.empresaId);
      return {
        fonte: lista.fonte,
        erro: lista.erro,
        modelos: modelosAprovados(lista.modelos, cfg?.template_idioma ?? "pt_BR"),
      };
    },
  );

/** Quantas pessoas estão em cada lista escolhida e quantas podem receber agora (para a Nova campanha). */
export const contagemListasNovaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (input: { listas: Array<{ grupo: string; familia: string; de?: number; ate?: number }> }) => ({
      listas: (Array.isArray(input.listas) ? input.listas : []).slice(0, 10).map((l) => ({
        grupo: String(l.grupo).slice(0, 10),
        familia: String(l.familia).slice(0, 20),
        ...(Number.isInteger(l.de) ? { de: Number(l.de) } : {}),
        ...(Number.isInteger(l.ate) ? { ate: Number(l.ate) } : {}),
      })),
    }),
  )
  .handler(async ({ data, context }) => {
    const opcoes = Object.fromEntries(
      data.listas.map((l) => [
        l.grupo,
        {
          [l.familia]: {
            ...(l.de !== undefined ? { de: l.de } : {}),
            ...(l.ate !== undefined ? { ate: l.ate } : {}),
          },
        },
      ]),
    );
    if (!Object.keys(opcoes).length) return {} as Record<string, { total: number; podem: number }>;
    const { data: r, error } = await context.supabase.rpc(
      "mkt_listas_contagem" as never,
      { _opcoes: opcoes } as never,
    );
    if (error) throw new Error(`Não foi possível contar as listas: ${error.message}`);
    return (r ?? {}) as unknown as Record<string, { total: number; podem: number }>;
  });

/** Quem atende as respostas (Alice ou equipe). Vale para as próximas respostas, a qualquer momento. */
export const quemRespondeFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { campanhaId: string; quem: QuemResponde }) => ({
    campanhaId: String(input.campanhaId),
    quem: (input.quem === "equipe" ? "equipe" : "alice") as QuemResponde,
  }))
  .handler(async ({ data, context }) => {
    const { db, campanha } = await campanhaDaEmpresa(context.empresaId, data.campanhaId);
    if (campanha.tipo !== "calendario") throw new Error("Só campanhas do calendário.");
    const { error } = await db
      .from("mkt_campanhas")
      .update({ quem_responde: data.quem })
      .eq("id", data.campanhaId)
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("Não foi possível trocar.");
    return { ok: true, quem: data.quem };
  });

export const aprovarCampanhaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { campanhaId: string }) => ({ campanhaId: String(input.campanhaId) }))
  .handler(async ({ data, context }) => {
    const { db, campanha } = await campanhaDaEmpresa(context.empresaId, data.campanhaId);
    if (campanha.status !== "aguardando_aprovacao")
      throw new Error("Esta campanha não está aguardando aprovação.");
    // Confere os modelos de novo na hora de aprovar (podem ter mudado na Meta).
    const { conferirCampanha } = await import("@/lib/mkt/campanhas.server");
    const conf = await conferirCampanha(db, data.campanhaId);
    if (conf.problemas.length) {
      const { rpc } = await import("@/lib/mkt/contexto.server");
      await rpc(db, "mkt_encerrar_campanha", {
        _campanha: data.campanhaId,
        _status: "bloqueada",
        _motivo: conf.problemas.join("; "),
      });
      throw new Error(`Campanha bloqueada: ${conf.problemas.join("; ")}`);
    }
    const { rpc } = await import("@/lib/mkt/contexto.server");
    await rpc(db, "mkt_aprovar_campanha", {
      _campanha: data.campanhaId,
      _usuario: context.userId,
      _hoje: null,
    });
    return { ok: true };
  });

export const recusarCampanhaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { campanhaId: string; motivo?: string }) => ({
    campanhaId: String(input.campanhaId),
    motivo: String(input.motivo ?? "").slice(0, 300),
  }))
  .handler(async ({ data, context }) => {
    const { db } = await campanhaDaEmpresa(context.empresaId, data.campanhaId);
    const { rpc } = await import("@/lib/mkt/contexto.server");
    await rpc(db, "mkt_encerrar_campanha", {
      _campanha: data.campanhaId,
      _status: "recusada",
      _motivo: data.motivo || "recusada no Nexa",
    });
    return { ok: true };
  });

/** Datas (terça a quinta, futuras) e condição (texto + %, ou sem condição). */
export const editarCampanhaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (input: {
      campanhaId: string;
      datas: string[];
      condicaoTexto: string | null;
      condicaoPct: number | null;
      /** "14:30" = dia e horário próprios; null = configuração; ausente = não muda. */
      horaInicio?: string | null;
    }) => {
      const datas = [...new Set((input.datas ?? []).map(String))]
        .filter((d) => DATA.test(d))
        .sort();
      if (!datas.length) throw new Error("Informe pelo menos uma data.");
      const pct =
        input.condicaoPct === null || input.condicaoPct === undefined
          ? null
          : Number(input.condicaoPct);
      if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 25))
        throw new Error("A condição vai de 0% a 25%.");
      const texto = (input.condicaoTexto ?? "").trim().slice(0, 200) || null;
      const hora =
        input.horaInicio === undefined
          ? undefined
          : input.horaInicio
            ? String(input.horaInicio).slice(0, 5)
            : null;
      if (hora && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora) || hora < "08:00" || hora > "20:00"))
        throw new Error("O horário de início vai das 08:00 às 20:00.");
      return {
        campanhaId: String(input.campanhaId),
        datas,
        condicaoTexto: texto,
        condicaoPct: pct,
        horaInicio: hora,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { db, campanha } = await campanhaDaEmpresa(context.empresaId, data.campanhaId);
    if (!["rascunho", "aguardando_aprovacao", "bloqueada"].includes(campanha.status))
      throw new Error("Só dá para editar antes da aprovação.");
    const { hojeSP, prepararCampanha } = await import("@/lib/mkt/campanhas.server");
    const hora =
      data.horaInicio === undefined
        ? ((campanha as { hora_inicio?: string | null }).hora_inicio?.slice(0, 5) ?? null)
        : data.horaInicio;
    if (hora) {
      // Dia e horário próprios: qualquer dia; hoje só se ainda faltar meia hora.
      const hoje = hojeSP();
      if (data.datas[0]! < hoje) throw new Error("A primeira data já passou.");
      if (data.datas[0] === hoje) {
        const [h, m] = horaSP().split(":").map(Number);
        const [hh, mm] = hora.split(":").map(Number);
        if (hh! * 60 + mm! < h! * 60 + m! + 30)
          throw new Error(
            "Hoje nesse horário não dá tempo: escolha pelo menos 30 minutos depois de agora.",
          );
      }
    } else {
      if (data.datas[0]! <= hojeSP())
        throw new Error("A primeira data precisa ser depois de hoje.");
      // Dias de disparo da configuração da empresa (não mais terça a quinta fixo).
      const dias = await diasDeDisparo(db, context.empresaId);
      for (const d of data.datas) {
        const dia = new Date(`${d}T12:00:00Z`).getUTCDay();
        if (!dias.includes(dia === 0 ? 7 : dia))
          throw new Error(
            `${d.split("-").reverse().join("/")} não é um dos dias de disparo da configuração.`,
          );
      }
    }
    const { error } = await db
      .from("mkt_campanhas")
      .update({
        datas_disparo: data.datas,
        condicao_texto: data.condicaoTexto,
        condicao_pct: data.condicaoPct,
        ...(data.horaInicio !== undefined ? { hora_inicio: data.horaInicio } : {}),
      })
      .eq("id", data.campanhaId);
    if (error) throw error;
    // Já preparada: monta de novo com as datas e a condição novas.
    if (campanha.status !== "rascunho") return prepararCampanha(db, data.campanhaId);
    return { ok: true };
  });

export const pausarFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { campanhaId: string; loteId?: string | null; retomar?: boolean }) => ({
    campanhaId: String(input.campanhaId),
    loteId: input.loteId && ID.test(input.loteId) ? input.loteId : null,
    retomar: Boolean(input.retomar),
  }))
  .handler(async ({ data, context }) => {
    const { db } = await campanhaDaEmpresa(context.empresaId, data.campanhaId);
    const { rpc } = await import("@/lib/mkt/contexto.server");
    const n = data.retomar
      ? await rpc<number>(db, "mkt_retomar", { _campanha: data.campanhaId, _lote: data.loteId })
      : await rpc<number>(db, "mkt_pausar", {
          _campanha: data.campanhaId,
          _lote: data.loteId,
          _motivo: "pausado no Nexa",
        });
    return { lotes: n };
  });

// ---------------------------------------------------------------- base de contatos
export type LinhaImportacao = {
  telefone: string;
  nome?: string | null;
  tipo?: "comprador" | "nao_comprador";
  servico_em?: string | null;
  servico_tipo?: string | null;
  entrada_em?: string | null;
  interesse?: string | null;
  /** Não comprador que pediu orçamento: a data de entrada vira a data do orçamento. */
  pediu_orcamento?: boolean | null;
};

export const importarContatosFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { linhas: LinhaImportacao[]; origem: string }) => {
    const linhas = (input.linhas ?? []).slice(0, 1000).map((l) => ({
      telefone: String(l.telefone ?? "").slice(0, 40),
      nome: l.nome ? String(l.nome).slice(0, 120) : null,
      tipo: l.tipo === "comprador" ? "comprador" : "nao_comprador",
      servico_em: l.servico_em && DATA.test(String(l.servico_em)) ? String(l.servico_em) : null,
      servico_tipo: l.servico_tipo ? String(l.servico_tipo).slice(0, 60) : null,
      entrada_em: l.entrada_em && DATA.test(String(l.entrada_em)) ? String(l.entrada_em) : null,
      interesse: l.interesse ? String(l.interesse).slice(0, 60) : null,
      pediu_orcamento: l.pediu_orcamento === true,
    }));
    return { linhas, origem: String(input.origem ?? "planilha").slice(0, 120) };
  })
  .handler(async ({ data, context }) => {
    const db = await servico();
    const { rpc } = await import("@/lib/mkt/contexto.server");
    return rpc<{
      lidas: number;
      novos: number;
      atualizados: number;
      invalidas: number;
      com_orcamento?: number;
    }>(db, "mkt_importar_contatos", {
      _emp: context.empresaId,
      _linhas: data.linhas,
      _origem: data.origem,
    });
  });

export const recalcularGruposFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }) => {
    const db = await servico();
    const { rpc } = await import("@/lib/mkt/contexto.server");
    await rpc(db, "mkt_sincronizar_base", { _emp: context.empresaId });
    const r = await rpc<{ grupos?: Record<string, number> } | null>(db, "mkt_calcular_grupos", {
      _emp: context.empresaId,
      _hoje: null,
    });
    return { grupos: r?.grupos ?? {} };
  });

// ---------------------------------------------------------------- gatilhos de hoje (manual)
export const gatilhosDeHoje = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("mkt_envios")
      .select(
        "id, grupo, template_nome, variante_sn, created_at, normalized_phone, mkt_contatos(nome, primeiro_nome, ultimo_servico_em, ultimo_servico_tipo), mkt_campanhas(gatilho, nome)",
      )
      .eq("empresa_id", context.empresaId)
      .eq("status", "manual")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    return data ?? [];
  });

/** Envio manual feito pelo celular (enviado) ou descartado. */
export const marcarGatilhoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { envioId: string; acao: "enviado" | "descartar" }) => {
    if (!ID.test(String(input.envioId))) throw new Error("Envio inválido.");
    return {
      envioId: String(input.envioId),
      acao: input.acao === "enviado" ? "enviado" : "descartar",
    };
  })
  .handler(async ({ data, context }) => {
    const db = await servico();
    const { error } = await db
      .from("mkt_envios")
      .update(
        data.acao === "enviado"
          ? { status: "enviado", enviado_em: new Date().toISOString(), erro: "enviado à mão" }
          : { status: "cancelado", erro: "descartado no Nexa" },
      )
      .eq("id", data.envioId)
      .eq("empresa_id", context.empresaId)
      .eq("status", "manual");
    if (error) throw error;
    return { ok: true };
  });

// ---------------------------------------------------------------- avisos e configuração
export const marcarAvisosLidosFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("mkt_avisos")
      .update({ lido_em: new Date().toISOString() })
      .eq("empresa_id", context.empresaId)
      .is("lido_em", null);
    if (error) throw error;
    return { ok: true };
  });

export type ConfigMktEditavel = {
  disparo_ligado: boolean;
  gatilho_c1_ligado: boolean;
  gatilho_c2_ligado: boolean;
  gatilho_c3_ligado: boolean;
  preparo_automatico: boolean;
  aviso_whatsapp_ligado: boolean;
  aviso_telefone: string | null;
  aviso_template_nome: string | null;
  link_avaliacao_google: string | null;
  /** Dias mínimos entre duas mensagens de marketing (campanha ou promoção) para a mesma pessoa. */
  limite_marketing_dias?: number;
};

export const salvarConfigMktFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: ConfigMktEditavel) => {
    const texto = (v: unknown, max: number) => (v ? String(v).trim().slice(0, max) || null : null);
    const link = texto(input.link_avaliacao_google, 300);
    if (link && !/^https:\/\//.test(link))
      throw new Error("O link da avaliação precisa começar com https://");
    const fone = texto(input.aviso_telefone, 20)?.replace(/\D/g, "") || null;
    if (fone && (fone.length < 10 || fone.length > 13))
      throw new Error("Telefone do aviso inválido.");
    const limite = Number(input.limite_marketing_dias ?? 30);
    if (!Number.isInteger(limite) || limite < 7 || limite > 365)
      throw new Error("Limite entre mensagens de marketing: de 7 a 365 dias.");
    return {
      limite_marketing_dias: limite,
      disparo_ligado: Boolean(input.disparo_ligado),
      gatilho_c1_ligado: Boolean(input.gatilho_c1_ligado),
      gatilho_c2_ligado: Boolean(input.gatilho_c2_ligado),
      gatilho_c3_ligado: Boolean(input.gatilho_c3_ligado),
      preparo_automatico: Boolean(input.preparo_automatico),
      aviso_whatsapp_ligado: Boolean(input.aviso_whatsapp_ligado),
      aviso_telefone: fone,
      aviso_template_nome: texto(input.aviso_template_nome, 100),
      link_avaliacao_google: link,
    };
  })
  .handler(async ({ data, context }) => {
    if (data.aviso_whatsapp_ligado && (!data.aviso_telefone || !data.aviso_template_nome))
      throw new Error("Para avisar no WhatsApp, informe o telefone e o modelo do aviso.");
    const { recusarNumeroDeCliente } = await import("@/lib/mkt/avisos-equipe.server");
    await recusarNumeroDeCliente(context.supabase, context.empresaId, data.aviso_telefone);
    const { error } = await context.supabase
      .from("mkt_configuracoes")
      .upsert({ empresa_id: context.empresaId, ...data }, { onConflict: "empresa_id" });
    if (error) throw error;
    return { ok: true };
  });

// ---------------------------------------------------------------- indicações (só leitura)
export type ResumoIndicacoes = {
  noMes: number;
  viraramServicoNoMes: number;
  descontoIndicadoPct: number;
  creditoIndicadorPct: number;
  recentes: {
    id: string;
    indicador: string;
    indicado: string;
    criadaEm: string;
    virouServico: boolean;
  }[];
};

/** Indique e ganhe: quantas indicações no mês, quantas viraram serviço e as últimas. */
export const resumoIndicacoesFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<ResumoIndicacoes> => {
    const sb = context.supabase;
    const { todayISO } = await import("@/lib/format");
    const inicioMes = new Date(`${todayISO().slice(0, 7)}-01T00:00:00-03:00`).toISOString();
    const [doMes, recentes] = await Promise.all([
      sb
        .from("indicacoes")
        .select("indicado_work_order_id")
        .eq("empresa_id", context.empresaId)
        .gte("criada_em", inicioMes)
        .limit(1000),
      sb
        .from("indicacoes")
        .select(
          "id, indicado_nome, indicado_phone, criada_em, indicado_work_order_id, desconto_indicado_pct, credito_indicador_pct, indicador:indicador_contato_id ( nome )",
        )
        .eq("empresa_id", context.empresaId)
        .order("criada_em", { ascending: false })
        .limit(10),
    ]);
    if (doMes.error || recentes.error) throw new Error("Não foi possível carregar as indicações.");
    const lista = (recentes.data ?? []) as unknown as Array<{
      id: string;
      indicado_nome: string | null;
      indicado_phone: string;
      criada_em: string;
      indicado_work_order_id: string | null;
      desconto_indicado_pct: number;
      credito_indicador_pct: number;
      indicador: { nome: string | null } | null;
    }>;
    return {
      noMes: doMes.data?.length ?? 0,
      viraramServicoNoMes: (doMes.data ?? []).filter((i) => i.indicado_work_order_id).length,
      descontoIndicadoPct: Number(lista[0]?.desconto_indicado_pct ?? 15),
      creditoIndicadorPct: Number(lista[0]?.credito_indicador_pct ?? 15),
      recentes: lista.map((i) => ({
        id: i.id,
        indicador: i.indicador?.nome || "Cliente",
        indicado: i.indicado_nome || i.indicado_phone,
        criadaEm: i.criada_em,
        virouServico: Boolean(i.indicado_work_order_id),
      })),
    };
  });
