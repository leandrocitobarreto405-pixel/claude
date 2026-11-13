/**
 * Gerente comercial: gera o relatório do período depois de um lote marcado para isso. Números do
 * sistema + leitura do Sonnet (padrões, erros com exemplos, sugestões e mudanças na Alice com
 * antes/depois, só como sugestão). Lê as instruções da Alice, não grava nada nelas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODELO_FICHA, custoUsd, type Ficha } from "./ficha";
import type { Fatos } from "./fatos";
import type { FichaResumo } from "./resumo";
import {
  resumoCurto,
  resumoDasClasses,
  type CampanhaRelatorio,
  type NumerosCampanha,
  type Sugestao,
} from "./campanhas";
import { textoMesRelatorio, type MesRelatorio } from "./equipe";
import {
  ESQUEMA_RELATORIO,
  codificarAvisos,
  fichaCompacta,
  instrucoesRelatorio,
  numerosDoRelatorio,
  sugestaoDeCadaAviso,
  type LeituraRelatorio,
} from "./relatorio";

type Db = SupabaseClient;

/** Receptivos nos últimos 30 dias por empresa, para a estimativa mensal da rotina diária. */
async function receptivosPorMes(db: Db): Promise<Array<{ empresa: string; leads: number }>> {
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: emps } = await db
    .from("empresas")
    .select("id, nome")
    .in("id", ["11111111-1111-1111-1111-111111111111", "f1b06dbe-39dc-4344-89f7-dd27a68046d8"]);
  const saida: Array<{ empresa: string; leads: number }> = [];
  for (const e of (emps ?? []) as Array<{ id: string; nome: string }>) {
    const { count } = await db
      .from("crm_leads")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", e.id)
      .eq("entrada", "receptivo")
      .gte("created_at", desde);
    saida.push({ empresa: e.nome, leads: count ?? 0 });
  }
  return saida;
}

/** Campanhas com acompanhamento atualizado nos últimos 14 dias, mais recentes primeiro. */
async function campanhasDoRelatorio(db: Db, empresaId: string): Promise<CampanhaRelatorio[]> {
  const { data } = await db
    .from("comercial_campanhas")
    .select(
      "janela_inicio, encerrada, numeros, respostas, sugestoes, leitura, atualizado_em, mkt_campanhas(nome)",
    )
    .eq("empresa_id", empresaId)
    .gte("atualizado_em", new Date(Date.now() - 14 * 86_400_000).toISOString())
    .order("janela_inicio", { ascending: false })
    .limit(10);
  return (
    (data ?? []) as unknown as Array<{
      encerrada: boolean;
      numeros: NumerosCampanha | Record<string, never>;
      respostas: { por_envio?: Record<string, never> } | null;
      sugestoes: Sugestao[] | null;
      leitura: string | null;
      mkt_campanhas: { nome: string } | null;
    }>
  )
    .filter((l) => "enviados" in l.numeros)
    .map((l) => ({
      nome: l.mkt_campanhas?.nome ?? "Campanha",
      resumo: resumoCurto(l.numeros as NumerosCampanha),
      numeros: l.numeros as NumerosCampanha,
      classes: resumoDasClasses(l.respostas?.por_envio ?? {}).map((c) => ({
        nome: c.nome,
        n: c.n,
      })),
      sugestoes: l.sugestoes ?? [],
      leitura: l.leitura,
      encerrada: l.encerrada,
    }));
}

export async function gerarRelatorioComercial(
  db: Db,
  o: {
    empresaId: string;
    periodo: string;
    /** Revisão semanal: só as fichas destes leads (sem isto, todas as fichas da empresa). */
    leadIds?: string[];
    /** Revisão semanal: avisos da equipe ainda não revisados (sinal forte). */
    avisos?: Array<{ id: string; tipo: "erro" | "acerto"; frase: string }>;
    /** Revisão semanal: bloco "Mês" (meta, previsão, agenda, alertas, plano e semana da equipe). */
    mes?: MesRelatorio;
  },
): Promise<{ id: string; custoUsd: number }> {
  let q = db
    .from("comercial_analises")
    .select(
      "grupo, status, servico, origem, resultado, valor_orcado, valor_vendido, nota, quem_atendeu, custo_usd, ficha, fatos, motivo_sugerido_id, crm_lead_id",
    )
    .eq("empresa_id", o.empresaId)
    .limit(2000);
  if (o.leadIds)
    q = q.in(
      "crm_lead_id",
      o.leadIds.length ? o.leadIds : ["00000000-0000-0000-0000-000000000000"],
    );
  const { data: linhas } = await q;
  const avisos = codificarAvisos(o.avisos ?? []);
  const { data: motivos } = await db
    .from("config_options")
    .select("id, name")
    .eq("empresa_id", o.empresaId)
    .eq("kind", "crm_loss_reason");
  type Linha = {
    grupo: "google" | "outras";
    status: FichaResumo["status"];
    servico: string | null;
    origem: string | null;
    resultado: FichaResumo["resultado"];
    valor_orcado: number | string | null;
    valor_vendido: number | string | null;
    nota: number | null;
    quem_atendeu: string | null;
    custo_usd: number | string;
    ficha: Ficha | null;
    fatos: Fatos | null;
    motivo_sugerido_id: string | null;
    crm_lead_id: string;
  };
  const ls = (linhas ?? []) as Linha[];
  const { data: leads } = ls.length
    ? await db
        .from("crm_leads")
        .select("id, loss_reason_id")
        .in(
          "id",
          ls.map((l) => l.crm_lead_id),
        )
    : { data: [] };
  const nomeMotivo = (id: string | null) =>
    ((motivos ?? []) as Array<{ id: string; name: string }>).find((m) => m.id === id)?.name ?? null;
  const motivoReg = new Map(
    ((leads ?? []) as Array<{ id: string; loss_reason_id: string | null }>).map((l) => [
      l.id,
      nomeMotivo(l.loss_reason_id),
    ]),
  );
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  const fichas: FichaResumo[] = ls.map((l) => ({
    grupo: l.grupo,
    status: l.status,
    servico: l.servico,
    origem: l.origem,
    resultado: l.resultado,
    valorOrcado: num(l.valor_orcado),
    valorVendido: num(l.valor_vendido),
    nota: l.nota,
    motivoSugerido: nomeMotivo(l.motivo_sugerido_id),
    motivoRegistrado: motivoReg.get(l.crm_lead_id) ?? null,
    quemAtendeu: l.quem_atendeu,
    custoUsd: Number(l.custo_usd),
    ficha: l.ficha,
    fatos: l.fatos,
  }));
  const numeros = numerosDoRelatorio(fichas);
  const compactas = fichas.map((f, i) => fichaCompacta(i + 1, f)).filter(Boolean);

  const [{ data: emp }, { data: ia }] = await Promise.all([
    db.from("empresas").select("nome").eq("id", o.empresaId).maybeSingle(),
    db
      .from("ia_configuracoes")
      .select("instrucoes, modulos")
      .eq("empresa_id", o.empresaId)
      .maybeSingle(),
  ]);
  const alice = ia as { instrucoes?: string | null; modulos?: unknown } | null;
  const textoAlice = [
    alice?.instrucoes ?? "",
    alice?.modulos ? `\nMÓDULOS:\n${JSON.stringify(alice.modulos)}` : "",
  ]
    .join("")
    .slice(0, 60_000);

  // Campanhas de WhatsApp acompanhadas pela Tatiana nos últimos 14 dias (números do sistema).
  const campanhas = await campanhasDoRelatorio(db, o.empresaId);

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { chamarIa } = await import("@/lib/alice/parada-ia.server");
  const resp = await chamarIa(
    () =>
      new Anthropic({ timeout: 290_000, maxRetries: 1 }).messages.create({
        model: MODELO_FICHA,
        max_tokens: 16_000,
        output_config: {
          effort: "medium",
          format: {
            type: "json_schema",
            schema: ESQUEMA_RELATORIO as unknown as Record<string, unknown>,
          },
        },
        system: instrucoesRelatorio((emp as { nome?: string } | null)?.nome ?? "empresa"),
        messages: [
          {
            role: "user",
            content: [
              "NÚMEROS DO SISTEMA:",
              JSON.stringify(numeros),
              "",
              `ATENDIMENTOS ANALISADOS (${compactas.length}), um por linha:`,
              compactas.map((c) => JSON.stringify(c)).join("\n"),
              "",
              ...(avisos.length
                ? [
                    `AVISOS DA EQUIPE (${avisos.length}), sinal forte:`,
                    avisos.map((a) => `${a.codigo} [${a.tipo}] ${a.frase}`).join("\n"),
                    "",
                  ]
                : []),
              ...(o.mes
                ? [
                    "MÊS (números do sistema; use como contexto das sugestões, sem repetir):",
                    ...textoMesRelatorio(o.mes),
                    "",
                  ]
                : []),
              ...(campanhas.length
                ? [
                    `CAMPANHAS DE WHATSAPP DA SEMANA (${campanhas.length}), números do sistema:`,
                    campanhas
                      .map(
                        (c) =>
                          `- ${c.nome}: ${c.resumo}${c.classes.length ? ` · respostas: ${c.classes.map((x) => `${x.nome} ${x.n}`).join(", ")}` : ""}`,
                      )
                      .join("\n"),
                    "",
                  ]
                : []),
              "INSTRUÇÕES ATUAIS DA ALICE (só leitura):",
              textoAlice || "(não encontradas)",
            ].join("\n"),
          },
        ],
      }),
    { empresaId: o.empresaId, origem: "relatorio" },
  );
  if (resp.stop_reason === "refusal") throw new Error("a IA recusou o relatório");
  if (resp.stop_reason === "max_tokens") throw new Error("relatório cortado (limite de tokens)");
  const leitura = JSON.parse(
    resp.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
  ) as LeituraRelatorio;
  const custo = custoUsd(resp.usage);
  const custoMedio = numeros.custo.medioUsd;
  const estimativaMensal = (await receptivosPorMes(db)).map((e) => ({
    ...e,
    usdMes: Math.round(e.leads * custoMedio * 100) / 100,
  }));
  const { data: salvo, error } = await db
    .from("comercial_relatorios")
    .insert({
      empresa_id: o.empresaId,
      periodo: o.periodo,
      dados: {
        numeros,
        leitura,
        estimativaMensal,
        custoRelatorioUsd: custo,
        avisos,
        campanhas,
        mes: o.mes ?? null,
      },
      modelo: MODELO_FICHA,
      tokens_entrada: resp.usage.input_tokens,
      tokens_saida: resp.usage.output_tokens,
      custo_usd: custo,
    })
    .select("id")
    .single();
  if (error || !salvo) throw new Error(`gravar o relatório: ${error?.message ?? "sem retorno"}`);
  const relatorioId = (salvo as { id: string }).id;
  // Cada aviso fica ligado à sugestão que ele gerou (ou só marcado como revisado).
  const agora = new Date().toISOString();
  for (const l of sugestaoDeCadaAviso(avisos, leitura.sugestoes ?? []))
    await db
      .from("comercial_avisos")
      .update({ relatorio_id: relatorioId, sugestao_indice: l.indice, revisado_em: agora })
      .eq("id", l.id)
      .eq("empresa_id", o.empresaId);
  return { id: relatorioId, custoUsd: custo };
}
