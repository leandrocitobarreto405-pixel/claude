/**
 * Tela "Gerente comercial" (só admin; ligada por empresa). Lê as fichas pelo login do admin (RLS) e
 * confirma perdas pelas funções do banco: nada vira perdido sem clique. Nada é enviado ao cliente.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminEmpresa } from "@/lib/empresa.middleware";
import type { Ficha } from "@/lib/comercial/ficha";
import type { Fatos } from "@/lib/comercial/fatos";
import type { LeituraRelatorio, NumerosRelatorio } from "@/lib/comercial/relatorio";

/** Decisão do dono sobre uma sugestão do relatório (só marca; não aplica nada na Alice). */
export type DecisaoSugestao = {
  decisao: "aprovada" | "recusada";
  motivo: string | null;
  texto: string;
  por: string;
  em: string;
};

export type RelatorioTela = {
  id: string;
  /** Por índice da sugestão em leitura.sugestoes. */
  decisoes: Record<string, DecisaoSugestao>;
  periodo: string;
  criadoEm: string;
  custoUsd: number;
  numeros: NumerosRelatorio;
  leitura: LeituraRelatorio;
  estimativaMensal: Array<{ empresa: string; leads: number; usdMes: number }>;
};

export type AnaliseTela = {
  id: string;
  leadId: string;
  leadNome: string | null;
  telefoneFinal: string | null;
  criadoEm: string | null;
  grupo: "google" | "outras";
  status: "pendente" | "ok" | "erro";
  erro: string | null;
  servico: string | null;
  origem: string | null;
  quemAtendeu: string | null;
  resultado: "vendeu" | "perdeu" | "sem_desfecho" | "sem_orcamento" | null;
  valorOrcado: number | null;
  valorVendido: number | null;
  nota: number | null;
  motivoSugeridoId: string | null;
  motivoSugerido: string | null;
  motivoRegistrado: string | null;
  fraseCliente: string | null;
  aindaVale: boolean | null;
  mensagemSugerida: string | null;
  pediuEncaixe: boolean;
  encaixePedidoEm: string | null;
  encaixeObs: string | null;
  leadPerdidoEm: string | null;
  perdaSituacao: "confirmada" | "trocada" | "nao_perdeu" | null;
  perdaMotivoFinal: string | null;
  custoUsd: number;
  ficha: Ficha | null;
  fatos: Fatos | null;
  analisadoEm: string | null;
};

export type GerenteComercial = {
  ligado: boolean;
  tetoUsd: number;
  rotinaDiaria: boolean;
  gastoUsd: number;
  lotes: Array<{
    id: string;
    descricao: string;
    status: string;
    total: number;
    processados: number;
    comErro: number;
    custoUsd: number;
    pedidoEm: string;
  }>;
  motivos: Array<{ id: string; nome: string; pedeData: string | null }>;
  analises: AnaliseTela[];
  relatorio: RelatorioTela | null;
};

type Db = SupabaseClient;

export const gerenteComercialFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<GerenteComercial> => {
    const db = context.supabase as unknown as Db;
    const empresaId = context.empresaId as string;
    const [{ data: cfg }, { data: lotes }, { data: motivos }, { data: analises }, { data: rel }] =
      await Promise.all([
        db.from("comercial_configuracoes").select("ligado, teto_usd, rotina_diaria").maybeSingle(),
        db
          .from("comercial_lotes")
          .select("id, descricao, status, leads, processados, com_erro, custo_usd, pedido_em")
          .order("pedido_em", { ascending: false })
          .limit(10),
        db
          .from("config_options")
          .select("id, name, metadata, display_order")
          .eq("empresa_id", empresaId)
          .eq("kind", "crm_loss_reason")
          .eq("active", true)
          .order("display_order"),
        db
          .from("comercial_analises")
          .select(
            "id, crm_lead_id, grupo, status, erro, servico, origem, quem_atendeu, resultado, valor_orcado, valor_vendido, nota, motivo_sugerido_id, frase_cliente, ainda_vale, mensagem_sugerida, pediu_encaixe, perda_situacao, perda_motivo_final_id, custo_usd, ficha, fatos, analisado_em",
          )
          .order("analisado_em", { ascending: false, nullsFirst: false })
          .limit(1000),
        db
          .from("comercial_relatorios")
          .select("id, custo_usd, periodo, criado_em, dados")
          .order("criado_em", { ascending: false }),
      ]);
    type LinhaAnalise = {
      id: string;
      crm_lead_id: string;
      grupo: "google" | "outras";
      status: AnaliseTela["status"];
      erro: string | null;
      servico: string | null;
      origem: string | null;
      quem_atendeu: string | null;
      resultado: AnaliseTela["resultado"];
      valor_orcado: number | string | null;
      valor_vendido: number | string | null;
      nota: number | null;
      motivo_sugerido_id: string | null;
      frase_cliente: string | null;
      ainda_vale: boolean | null;
      mensagem_sugerida: string | null;
      pediu_encaixe: boolean;
      perda_situacao: AnaliseTela["perdaSituacao"];
      perda_motivo_final_id: string | null;
      custo_usd: number | string;
      ficha: Ficha | null;
      fatos: Fatos | null;
      analisado_em: string | null;
    };
    const linhas = (analises ?? []) as LinhaAnalise[];
    const leadIds = linhas.map((a) => a.crm_lead_id);
    const { data: leads } = leadIds.length
      ? await db
          .from("crm_leads")
          .select(
            "id, lead_name, normalized_phone, created_at, perdido_em, loss_reason_id, encaixe_pedido_em, encaixe_obs",
          )
          .in("id", leadIds)
      : { data: [] };
    type LinhaLead = {
      id: string;
      lead_name: string | null;
      normalized_phone: string | null;
      created_at: string;
      perdido_em: string | null;
      loss_reason_id: string | null;
      encaixe_pedido_em: string | null;
      encaixe_obs: string | null;
    };
    const porLead = new Map(((leads ?? []) as LinhaLead[]).map((l) => [l.id, l]));
    const listaMotivos = (
      (motivos ?? []) as Array<{
        id: string;
        name: string;
        metadata: Record<string, unknown> | null;
      }>
    ).map((m) => ({
      id: m.id,
      nome: m.name,
      pedeData: (m.metadata?.["pede_data"] as string | undefined) ?? null,
    }));
    const nomeMotivo = (id: string | null) => listaMotivos.find((m) => m.id === id)?.nome ?? null;
    const soma = (xs: Array<{ custo_usd: number | string }>) =>
      xs.reduce((s, x) => s + Number(x.custo_usd ?? 0), 0);
    const config = cfg as {
      ligado: boolean;
      teto_usd: number | string;
      rotina_diaria: boolean;
    } | null;
    const num = (v: number | string | null) => (v === null ? null : Number(v));

    const ultimo = (
      (rel ?? []) as Array<{
        id: string;
        custo_usd: number | string;
        periodo: string;
        criado_em: string;
        dados: Omit<RelatorioTela, "id" | "periodo" | "criadoEm" | "custoUsd">;
      }>
    )[0];
    return {
      relatorio: ultimo
        ? {
            id: ultimo.id,
            decisoes: ultimo.dados.decisoes ?? {},
            periodo: ultimo.periodo,
            criadoEm: ultimo.criado_em,
            custoUsd: Number(ultimo.custo_usd),
            numeros: ultimo.dados.numeros,
            leitura: ultimo.dados.leitura,
            estimativaMensal: ultimo.dados.estimativaMensal ?? [],
          }
        : null,
      ligado: Boolean(config?.ligado),
      tetoUsd: Number(config?.teto_usd ?? 0),
      rotinaDiaria: Boolean(config?.rotina_diaria),
      gastoUsd: soma(linhas) + soma((rel ?? []) as Array<{ custo_usd: number | string }>),
      lotes: (
        (lotes ?? []) as Array<{
          id: string;
          descricao: string;
          status: string;
          leads: string[];
          processados: number;
          com_erro: number;
          custo_usd: number | string;
          pedido_em: string;
        }>
      ).map((l) => ({
        id: l.id,
        descricao: l.descricao,
        status: l.status,
        total: l.leads.length,
        processados: l.processados,
        comErro: l.com_erro,
        custoUsd: Number(l.custo_usd),
        pedidoEm: l.pedido_em,
      })),
      motivos: listaMotivos,
      analises: linhas.map((a): AnaliseTela => {
        const l = porLead.get(a.crm_lead_id);
        return {
          id: a.id,
          leadId: a.crm_lead_id,
          leadNome: l?.lead_name ?? null,
          telefoneFinal: l?.normalized_phone ? l.normalized_phone.slice(-4) : null,
          criadoEm: l?.created_at ?? null,
          grupo: a.grupo,
          status: a.status,
          erro: a.erro,
          servico: a.servico,
          origem: a.origem,
          quemAtendeu: a.quem_atendeu,
          resultado: a.resultado,
          valorOrcado: num(a.valor_orcado),
          valorVendido: num(a.valor_vendido),
          nota: a.nota,
          motivoSugeridoId: a.motivo_sugerido_id,
          motivoSugerido: nomeMotivo(a.motivo_sugerido_id),
          motivoRegistrado: nomeMotivo(l?.loss_reason_id ?? null),
          fraseCliente: a.frase_cliente,
          aindaVale: a.ainda_vale,
          mensagemSugerida: a.mensagem_sugerida,
          pediuEncaixe: a.pediu_encaixe,
          encaixePedidoEm: l?.encaixe_pedido_em ?? null,
          encaixeObs: l?.encaixe_obs ?? null,
          leadPerdidoEm: l?.perdido_em ?? null,
          perdaSituacao: a.perda_situacao,
          perdaMotivoFinal: nomeMotivo(a.perda_motivo_final_id),
          custoUsd: Number(a.custo_usd),
          ficha: a.ficha,
          fatos: a.fatos,
          analisadoEm: a.analisado_em,
        };
      }),
    };
  });

const UUID = /^[0-9a-f-]{36}$/i;
const uuid = (v: unknown, nome: string) => {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new Error(`${nome} inválido.`);
  return s;
};

export const confirmarPerdaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (d: { analiseId: string; motivoId: string; obs?: string; data?: string | null }) => ({
      analiseId: uuid(d.analiseId, "Análise"),
      motivoId: uuid(d.motivoId, "Motivo"),
      obs: String(d.obs ?? "").slice(0, 300),
      data: d.data && /^\d{4}-\d{2}-\d{2}$/.test(d.data) ? d.data : null,
    }),
  )
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as Db;
    const { error } = await db.rpc("comercial_confirmar_perda", {
      _analise: data.analiseId,
      _motivo: data.motivoId,
      _obs: data.obs || null,
      _data: data.data,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const naoPerdeuFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((d: { analiseId: string }) => ({ analiseId: uuid(d.analiseId, "Análise") }))
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as Db;
    const { error } = await db.rpc("comercial_nao_perdeu", { _analise: data.analiseId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const marcarEncaixeFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((d: { leadId: string; pediu: boolean; obs?: string }) => ({
    leadId: uuid(d.leadId, "Lead"),
    pediu: Boolean(d.pediu),
    obs: String(d.obs ?? "").slice(0, 300),
  }))
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as Db;
    const { error } = await db.rpc("marcar_encaixe", {
      _lead: data.leadId,
      _pediu: data.pediu,
      _obs: data.obs || null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Aprovar ou recusar uma sugestão do relatório: só guarda a decisão (quem, quando, motivo) dentro
 * do próprio relatório, para alimentar o manual depois. Não aplica nada na Alice.
 */
export const decidirSugestaoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (d: { relatorioId: string; indice: number; decisao: string; motivo?: string | null }) => {
      const indice = Number(d.indice);
      if (!Number.isInteger(indice) || indice < 0 || indice > 50)
        throw new Error("Sugestão inválida.");
      if (d.decisao !== "aprovada" && d.decisao !== "recusada" && d.decisao !== "desfazer")
        throw new Error("Decisão inválida.");
      return {
        relatorioId: uuid(d.relatorioId, "Relatório"),
        indice,
        decisao: d.decisao as "aprovada" | "recusada" | "desfazer",
        motivo:
          String(d.motivo ?? "")
            .trim()
            .slice(0, 300) || null,
      };
    },
  )
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as Db;
    const empresaId = context.empresaId as string;
    // Empresa só para consulta (assinatura em atraso) não grava, como no resto do app.
    const { data: sit } = await db.rpc("situacao_assinatura", { _emp: empresaId });
    const situacao = (sit as { situacao?: string } | null)?.situacao;
    if (situacao === "somente_leitura" || situacao === "bloqueada")
      throw new Error("Empresa em modo somente leitura: a decisão não foi gravada.");
    // Lê pelo login do admin (RLS); grava pelo servidor (a tabela não tem escrita pela tela).
    const { data: rel } = await db
      .from("comercial_relatorios")
      .select("id, dados")
      .eq("id", data.relatorioId)
      .maybeSingle();
    if (!rel) throw new Error("Relatório não encontrado.");
    const dados = (rel as { dados: Record<string, unknown> }).dados ?? {};
    const sugestoes = ((dados["leitura"] as { sugestoes?: Array<{ sugestao: string }> })
      ?.sugestoes ?? []) as Array<{ sugestao: string }>;
    const sugestao = sugestoes[data.indice];
    if (!sugestao) throw new Error("Sugestão não encontrada.");
    const decisoes = { ...((dados["decisoes"] as Record<string, DecisaoSugestao>) ?? {}) };
    if (data.decisao === "desfazer") delete decisoes[String(data.indice)];
    else
      decisoes[String(data.indice)] = {
        decisao: data.decisao,
        motivo: data.decisao === "recusada" ? data.motivo : null,
        texto: sugestao.sugestao,
        por: context.userId as string,
        em: new Date().toISOString(),
      };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Tabela ainda fora dos tipos gerados: cliente sem tipos, como no resto deste arquivo.
    const { error } = await (supabaseAdmin as unknown as Db)
      .from("comercial_relatorios")
      .update({ dados: { ...dados, decisoes } as never })
      .eq("id", data.relatorioId)
      .eq("empresa_id", empresaId);
    if (error) throw new Error(error.message);
    return { ok: true, decisoes };
  });
