/**
 * Tela "Leads do site" (CRM) e a configuração em Configurações → Leads do site.
 * Admin e atendente veem e agem; técnico não. Configurar é só para admin. O envio automático do
 * modelo começa desligado; o botão da tela manda o modelo só quando alguém toca.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";

export type SituacaoLeadSite = "nao_chamou" | "chamou" | "invalido" | "chamado_equipe";

export type LeadSite = {
  id: string;
  cadastradoEm: string;
  nome: string | null;
  telefoneDigitado: string | null;
  telefone: string | null;
  lp: string;
  utmTerm: string | null;
  servico: string | null;
  situacao: SituacaoLeadSite;
  chamouEm: string | null;
  chamadoEquipeEm: string | null;
  conversaId: string | null;
  crmLeadId: string | null;
  modeloEnviadoEm: string | null;
  modeloErro: string | null;
  repetidos: number;
};

async function exigirEscritorio(db: SupabaseClient<Database>) {
  const { data, error } = await db.rpc("meu_papel" as never);
  if (error) throw error;
  if (data !== "admin" && data !== "atendente")
    throw new Error("Só administradores e atendentes podem ver os leads do site.");
}

const PERIODOS = { hoje: 0, "7d": 7, "30d": 30 } as const;

export const listarLeadsSite = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((input: { periodo: keyof typeof PERIODOS }) => {
    if (!(input.periodo in PERIODOS)) throw new Error("Período inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await exigirEscritorio(db);
    const hoje = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
    const inicio = new Date(
      Date.parse(`${hoje}T00:00:00-03:00`) - PERIODOS[data.periodo] * 86400_000,
    );
    const [{ data: linhas, error }, { data: planilhas }, { data: cfg }] = await Promise.all([
      db
        .from("leads_site")
        .select(
          "id, cadastrado_em, nome, telefone_digitado, telefone, lp, utm_term, servico, situacao, chamou_em, chamado_equipe_em, conversa_id, crm_lead_id, modelo_enviado_em, modelo_erro, repetido_de",
        )
        .eq("empresa_id", context.empresaId)
        .gte("cadastrado_em", inicio.toISOString())
        .order("cadastrado_em", { ascending: false })
        .limit(500),
      db
        .from("leads_site_planilhas")
        .select("nome, ativa, lido_em, erro")
        .eq("empresa_id", context.empresaId),
      db
        .from("leads_site_configuracoes")
        .select("envio_ligado, envio_modelo")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
    ]);
    if (error) throw new Error("Não foi possível carregar os leads do site.");
    const repetidos = new Map<string, number>();
    for (const l of linhas ?? [])
      if (l.repetido_de) repetidos.set(l.repetido_de, (repetidos.get(l.repetido_de) ?? 0) + 1);
    const leads: LeadSite[] = (linhas ?? [])
      .filter((l) => !l.repetido_de)
      .map((l) => ({
        id: l.id,
        cadastradoEm: l.cadastrado_em,
        nome: l.nome,
        telefoneDigitado: l.telefone_digitado,
        telefone: l.telefone,
        lp: l.lp,
        utmTerm: l.utm_term,
        servico: l.servico,
        situacao: l.situacao as SituacaoLeadSite,
        chamouEm: l.chamou_em,
        chamadoEquipeEm: l.chamado_equipe_em,
        conversaId: l.conversa_id,
        crmLeadId: l.crm_lead_id,
        modeloEnviadoEm: l.modelo_enviado_em,
        modeloErro: l.modelo_erro,
        repetidos: repetidos.get(l.id) ?? 0,
      }));
    return {
      leads,
      planilhas: (planilhas ?? []).map((p) => ({
        nome: p.nome,
        ativa: p.ativa,
        lidoEm: p.lido_em,
        erro: p.erro,
      })),
      envioLigado: Boolean(cfg?.envio_ligado),
      modelo: cfg?.envio_modelo ?? "tc_lead_site",
    };
  });

const ID = /^[0-9a-f-]{36}$/i;

/** "Marcar como chamado" (ou desfazer). */
export const marcarLeadChamado = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { id: string; chamado: boolean }) => {
    if (!ID.test(input.id)) throw new Error("Lead inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await exigirEscritorio(context.supabase);
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const { data: l } = await db
      .from("leads_site")
      .select("id, situacao, telefone")
      .eq("id", data.id)
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (!l) throw new Error("Lead não encontrado.");
    if (l.situacao === "chamou") throw new Error("Este lead já chamou no WhatsApp.");
    const { error } = await db
      .from("leads_site")
      .update(
        data.chamado
          ? {
              situacao: "chamado_equipe",
              chamado_equipe_em: new Date().toISOString(),
              chamado_por: context.userId,
            }
          : {
              situacao: l.telefone ? "nao_chamou" : "invalido",
              chamado_equipe_em: null,
              chamado_por: null,
            },
      )
      .eq("id", l.id);
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });

/** Manda o modelo aprovado ao lead (só quando alguém toca). Uma vez por lead. */
export const chamarLeadPeloModelo = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { id: string }) => {
    if (!ID.test(input.id)) throw new Error("Lead inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await exigirEscritorio(context.supabase);
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const { data: l } = await db
      .from("leads_site")
      .select("id, empresa_id, nome, telefone, situacao, modelo_enviado_em")
      .eq("id", data.id)
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (!l) throw new Error("Lead não encontrado.");
    if (!l.telefone) throw new Error("Número inválido: ligue ou confira o número.");
    if (l.modelo_enviado_em) throw new Error("A mensagem já foi enviada para este lead.");
    if (l.situacao === "chamou") throw new Error("Este lead já chamou: abra a conversa.");
    const { data: cfg } = await db
      .from("leads_site_configuracoes")
      .select("envio_modelo")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    const { enviarModeloAoLead } = await import("@/lib/leads-site.server");
    try {
      await enviarModeloAoLead(
        db,
        { id: l.id, empresa_id: l.empresa_id, nome: l.nome, telefone: l.telefone },
        cfg?.envio_modelo ?? "tc_lead_site",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Não foi possível enviar: ${msg.slice(0, 200)}`);
    }
    await db
      .from("leads_site")
      .update({
        situacao: "chamado_equipe",
        chamado_equipe_em: new Date().toISOString(),
        chamado_por: context.userId,
      })
      .eq("id", l.id);
    return { ok: true };
  });

// ---------------------------------------------------------------- configuração (admin)

export type ConfigLeadsSite = {
  planilhas: Array<{
    id: string;
    nome: string;
    planilhaId: string;
    aba: string;
    ativa: boolean;
    ultimaLinha: number;
    lidoEm: string | null;
    erro: string | null;
  }>;
  avisoMinutos: number;
  envioLigado: boolean;
  envioAposMinutos: number;
  envio24h: boolean;
  envioHoraInicio: string;
  envioHoraFim: string;
  envioModelo: string;
  situacaoModelo: "aprovado" | "pendente" | "rejeitado" | "nao_existe" | "?";
};

export const configLeadsSite = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<ConfigLeadsSite> => {
    const db = context.supabase;
    const [{ data: planilhas }, { data: cfg }] = await Promise.all([
      db
        .from("leads_site_planilhas")
        .select("id, nome, planilha_id, aba, ativa, ultima_linha, lido_em, erro")
        .eq("empresa_id", context.empresaId)
        .order("created_at"),
      db
        .from("leads_site_configuracoes")
        .select("*")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
    ]);
    const modelo = cfg?.envio_modelo ?? "tc_lead_site";
    let situacaoModelo: ConfigLeadsSite["situacaoModelo"] = "?";
    try {
      const { dbServico } = await import("@/lib/mkt/contexto.server");
      const { modelosAtualizados } = await import("@/lib/mkt/modelos-situacao.server");
      const { modelos } = await modelosAtualizados(await dbServico(), context.empresaId, {
        precisa: [modelo],
      });
      const m = modelos.find((x) => x.name === modelo);
      const s = String(m?.status ?? "").toUpperCase();
      situacaoModelo = !m
        ? "nao_existe"
        : s === "APPROVED"
          ? "aprovado"
          : s === "REJECTED"
            ? "rejeitado"
            : "pendente";
    } catch {
      situacaoModelo = "?";
    }
    return {
      planilhas: (planilhas ?? []).map((p) => ({
        id: p.id,
        nome: p.nome,
        planilhaId: p.planilha_id,
        aba: p.aba,
        ativa: p.ativa,
        ultimaLinha: p.ultima_linha,
        lidoEm: p.lido_em,
        erro: p.erro,
      })),
      avisoMinutos: cfg?.aviso_minutos ?? 10,
      envioLigado: Boolean(cfg?.envio_ligado),
      envioAposMinutos: cfg?.envio_apos_minutos ?? 5,
      envio24h: cfg?.envio_24h ?? true,
      envioHoraInicio: String(cfg?.envio_hora_inicio ?? "08:00").slice(0, 5),
      envioHoraFim: String(cfg?.envio_hora_fim ?? "20:00").slice(0, 5),
      envioModelo: modelo,
      situacaoModelo,
    };
  });

/** Aceita o link da planilha ou só o id. */
export function idDaPlanilha(valor: string): string | null {
  const v = valor.trim();
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/.exec(v);
  const id = m ? m[1]! : v;
  return /^[A-Za-z0-9_-]{20,100}$/.test(id) ? id : null;
}

export const salvarPlanilhaLeads = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (input: { id?: string; nome: string; planilha: string; aba: string; ativa: boolean }) => {
      if (input.id && !ID.test(input.id)) throw new Error("Planilha inválida.");
      if (!input.nome.trim() || input.nome.trim().length > 80)
        throw new Error("Dê um nome para a LP (até 80 letras).");
      if (!idDaPlanilha(input.planilha))
        throw new Error("Cole o link da planilha do Google (ou o id dela).");
      if (!input.aba.trim() || input.aba.trim().length > 100) throw new Error("Informe a aba.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const campos = {
      nome: data.nome.trim(),
      planilha_id: idDaPlanilha(data.planilha)!,
      aba: data.aba.trim(),
      ativa: data.ativa,
      updated_at: new Date().toISOString(),
    };
    const { error } = data.id
      ? await db
          .from("leads_site_planilhas")
          .update(campos)
          .eq("id", data.id)
          .eq("empresa_id", context.empresaId)
      : await db.from("leads_site_planilhas").insert({ ...campos, empresa_id: context.empresaId });
    if (error)
      throw new Error(
        error.code === "23505"
          ? "Essa planilha e aba já estão cadastradas."
          : "Não foi possível salvar.",
      );
    return { ok: true };
  });

/** Lê o cabeçalho e conta as linhas, sem gravar nada (nem na planilha, nem no banco). */
export const conferirPlanilhaLeads = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { planilha: string; aba: string }) => {
    if (!idDaPlanilha(input.planilha)) throw new Error("Cole o link da planilha do Google.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { tokenDaEmpresa, lerAba } = await import("@/lib/google-planilhas.server");
    const { mapaDoCabecalho } = await import("@/lib/leads-site");
    try {
      const token = await tokenDaEmpresa(context.empresaId);
      const valores = await lerAba(token, idDaPlanilha(data.planilha)!, data.aba.trim() || "Leads");
      const mapa = mapaDoCabecalho(valores[0] ?? []);
      const faltam = (["data_hora", "nome", "telefone_digitado"] as const).filter(
        (c) => mapa[c] === undefined,
      );
      return {
        ok: faltam.length === 0,
        linhas: Math.max(0, valores.length - 1),
        colunas: Object.keys(mapa).length,
        faltam: faltam.map((c) =>
          c === "data_hora" ? "Data e Hora" : c === "telefone_digitado" ? "WhatsApp" : "Nome",
        ),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const acao =
        e && typeof e === "object" && "acao" in e && typeof e.acao === "string" ? e.acao : null;
      return { ok: false, linhas: 0, colunas: 0, faltam: [], erro: msg.slice(0, 300), acao };
    }
  });

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export const salvarConfigLeadsSite = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (input: {
      avisoMinutos: number;
      envioAposMinutos: number;
      envio24h: boolean;
      envioHoraInicio: string;
      envioHoraFim: string;
      envioModelo: string;
    }) => {
      if (
        !Number.isInteger(input.avisoMinutos) ||
        input.avisoMinutos < 5 ||
        input.avisoMinutos > 120
      )
        throw new Error("Aviso: entre 5 e 120 minutos.");
      if (
        !Number.isInteger(input.envioAposMinutos) ||
        input.envioAposMinutos < 5 ||
        input.envioAposMinutos > 240
      )
        throw new Error("Envio: entre 5 e 240 minutos.");
      if (!HORA.test(input.envioHoraInicio) || !HORA.test(input.envioHoraFim))
        throw new Error("Horário inválido (use HH:MM).");
      if (input.envioHoraFim <= input.envioHoraInicio)
        throw new Error("O horário final precisa ser depois do inicial.");
      if (!/^[a-z0-9_]{1,100}$/.test(input.envioModelo.trim()))
        throw new Error("Nome do modelo: só letras minúsculas, números e _.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const { error } = await db.from("leads_site_configuracoes").upsert(
      {
        empresa_id: context.empresaId,
        aviso_minutos: data.avisoMinutos,
        envio_apos_minutos: data.envioAposMinutos,
        envio_24h: data.envio24h,
        envio_hora_inicio: data.envioHoraInicio,
        envio_hora_fim: data.envioHoraFim,
        envio_modelo: data.envioModelo.trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id" },
    );
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });

/** "Ativar" / "Desativar" o envio automático. Só cadastros lidos depois de ativar recebem. */
export const ativarEnvioLeadsSite = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { ligado: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const { error } = await db.from("leads_site_configuracoes").upsert(
      {
        empresa_id: context.empresaId,
        envio_ligado: data.ligado,
        envio_ativado_em: data.ligado ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id" },
    );
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });
