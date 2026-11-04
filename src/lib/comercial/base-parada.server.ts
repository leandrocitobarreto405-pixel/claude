/** Base parada da Tatiana (04/11): grupos, amostra lida no Opus e recado só para o admin. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AMOSTRA_BASE,
  DIAS_PARADO,
  ESQUEMA_BASE_PARADA,
  GRUPOS_BASE,
  NOME_GRUPO_BASE,
  RECOMENDACOES,
  TIPO_BASE_PARADA,
  amostraProporcional,
  exemplosValidos,
  grupoDaBase,
  instrucoesBaseParada,
  type DadosBaseParada,
  type GrupoBase,
  type Recomendacao,
} from "./base-parada";
import { LIMITE_DESCADASTRO_PCT } from "./campanhas";
import { MODELO_OPUS, PRECO_OPUS, custoUsd } from "./ficha";
import { CAIXINHAS_FINALIZADAS } from "./furos";

type Db = SupabaseClient;

/** Leitura paginada (o PostgREST corta em 1000 linhas). */
async function todas<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null }>,
): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; de < 50_000; de += 1000) {
    const { data } = await consulta(de, de + 999);
    const lista = (data ?? []) as T[];
    saida.push(...lista);
    if (lista.length < 1000) break;
  }
  return saida;
}

type LeadParado = { id: string; fim: string; grupo: GrupoBase };

/** Os leads parados da empresa, cada um no seu grupo. */
export async function leadsParados(db: Db, empresaId: string, agora: Date): Promise<LeadParado[]> {
  const desde = new Date(agora.getTime() - DIAS_PARADO * 86_400_000).toISOString();
  const trintaDias = new Date(agora.getTime() - 30 * 86_400_000).toISOString();
  const [leads, fichas, pendentes, orcamentos, recentes, disparos] = await Promise.all([
    todas<{
      id: string;
      entrada: string | null;
      respondeu_em: string | null;
      normalized_phone: string | null;
      linked_work_order_id: string | null;
    }>((de, ate) =>
      db
        .from("crm_leads")
        .select("id, entrada, respondeu_em, normalized_phone, linked_work_order_id")
        .eq("empresa_id", empresaId)
        .eq("is_open", true)
        .is("perdido_em", null)
        .order("id")
        .range(de, ate),
    ),
    todas<{ crm_lead_id: string; caixinha: number | null }>((de, ate) =>
      db
        .from("comercial_analises")
        .select("crm_lead_id, caixinha")
        .eq("empresa_id", empresaId)
        .order("crm_lead_id")
        .range(de, ate),
    ),
    todas<{ crm_lead_id: string | null }>((de, ate) =>
      db
        .from("crm_followups")
        .select("crm_lead_id")
        .eq("empresa_id", empresaId)
        .eq("status", "Pendente")
        .order("id")
        .range(de, ate),
    ),
    todas<{
      crm_lead_id: string | null;
      status: string | null;
      generated_work_order_id: string | null;
      created_at: string;
    }>((de, ate) =>
      db
        .from("quotes")
        .select("crm_lead_id, status, generated_work_order_id, created_at")
        .eq("empresa_id", empresaId)
        .not("crm_lead_id", "is", null)
        .order("id")
        .range(de, ate),
    ),
    todas<{ crm_lead_id: string }>((de, ate) =>
      db
        .from("whatsapp_messages")
        .select("crm_lead_id")
        .eq("empresa_id", empresaId)
        .eq("privada", false)
        .not("crm_lead_id", "is", null)
        .gte("message_timestamp", desde)
        .order("id")
        .range(de, ate),
    ),
    todas<{ normalized_phone: string }>((de, ate) =>
      db
        .from("mkt_envios")
        .select("normalized_phone")
        .eq("empresa_id", empresaId)
        .not("enviado_em", "is", null)
        .order("id")
        .range(de, ate),
    ),
  ]);
  const caixinha = new Map(fichas.map((f) => [f.crm_lead_id, f.caixinha]));
  const comToque = new Set(pendentes.map((p) => p.crm_lead_id).filter(Boolean) as string[]);
  const comMensagem = new Set(recentes.map((m) => m.crm_lead_id));
  const comDisparo = new Set(disparos.map((d) => d.normalized_phone));
  const teveOrcamento = new Set<string>();
  const orcamentoAberto = new Set<string>();
  for (const q of orcamentos) {
    if (!q.crm_lead_id) continue;
    teveOrcamento.add(q.crm_lead_id);
    if (
      ["rascunho", "enviado", "aprovado"].includes(q.status ?? "") &&
      !q.generated_work_order_id &&
      q.created_at >= trintaDias
    )
      orcamentoAberto.add(q.crm_lead_id);
  }
  const saida: LeadParado[] = [];
  for (const l of leads) {
    const cx = caixinha.get(l.id) ?? null;
    if (cx !== null && CAIXINHAS_FINALIZADAS.has(cx)) continue;
    if (l.linked_work_order_id || comToque.has(l.id) || orcamentoAberto.has(l.id)) continue;
    if (comMensagem.has(l.id)) continue;
    saida.push({
      id: l.id,
      fim: (l.normalized_phone ?? "").slice(-4),
      grupo: grupoDaBase({
        entrada: l.entrada,
        respondeu: Boolean(l.respondeu_em),
        recebeuDisparo: Boolean(l.normalized_phone && comDisparo.has(l.normalized_phone)),
        teveOrcamento: teveOrcamento.has(l.id),
      }),
    });
  }
  return saida;
}

/** Sorteia a amostra de cada grupo (embaralha e pega os primeiros). */
function sortear<T>(xs: T[], n: number): T[] {
  const c = [...xs];
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j] as T, c[i] as T];
  }
  return c.slice(0, n);
}

/** Últimas mensagens (até 12) de cada lead da amostra, em texto curto. */
async function conversasDaAmostra(
  db: Db,
  empresaId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const saida = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 25) {
    const parte = ids.slice(i, i + 25);
    const { data } = await db
      .from("whatsapp_messages")
      .select(
        "crm_lead_id, direction, remetente_tipo, text_content, transcricao, message_type, message_timestamp",
      )
      .eq("empresa_id", empresaId)
      .eq("privada", false)
      .in("crm_lead_id", parte)
      .order("message_timestamp", { ascending: false })
      .limit(25 * 40);
    const porLead = new Map<string, string[]>();
    for (const m of (data ?? []) as Array<{
      crm_lead_id: string;
      direction: string;
      remetente_tipo: string | null;
      text_content: string | null;
      transcricao: string | null;
      message_type: string | null;
      message_timestamp: string;
    }>) {
      const lista = porLead.get(m.crm_lead_id) ?? [];
      if (lista.length >= 12) continue;
      const quem =
        m.direction === "Recebida"
          ? "Cliente"
          : m.remetente_tipo === "agent_bot"
            ? "Alice/disparo"
            : "Equipe";
      const texto = (m.text_content || m.transcricao || `[${m.message_type ?? "mídia"}]`)
        .replace(/\s+/g, " ")
        .slice(0, 220);
      const dia = new Date(m.message_timestamp).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
      });
      lista.push(`${dia} ${quem}: ${texto}`);
      porLead.set(m.crm_lead_id, lista);
    }
    for (const [id, linhas] of porLead) saida.set(id, linhas.reverse().join("\n"));
  }
  return saida;
}

/** Campanhas dos últimos 60 dias, com a data e o descadastro, para a regra dos 30 dias e dos 5%. */
async function campanhasRecentes(db: Db, empresaId: string, agora: Date): Promise<string[]> {
  const desde = new Date(agora.getTime() - 60 * 86_400_000).toISOString();
  const { data } = await db
    .from("comercial_campanhas")
    .select("campanha_id, janela_inicio, janela_fim, numeros")
    .eq("empresa_id", empresaId)
    .gte("janela_inicio", desde)
    .order("janela_inicio", { ascending: false })
    .limit(10);
  const linhas = (data ?? []) as Array<{
    campanha_id: string;
    janela_inicio: string;
    janela_fim: string | null;
    numeros: {
      enviados?: number;
      responderam?: number;
      descadastros?: number;
      orcamentos?: number;
      fecharam?: number;
    } | null;
  }>;
  if (!linhas.length) return [];
  const { data: ks } = await db
    .from("mkt_campanhas")
    .select("id, nome")
    .in(
      "id",
      linhas.map((l) => l.campanha_id),
    );
  const nome = new Map(
    ((ks ?? []) as Array<{ id: string; nome: string }>).map((k) => [k.id, k.nome]),
  );
  const dm = (iso: string) =>
    new Date(iso).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
    });
  return linhas.map((l) => {
    const n = l.numeros ?? {};
    const env = n.enviados ?? 0;
    const desc = env ? Math.round(((n.descadastros ?? 0) / env) * 1000) / 10 : 0;
    return `- ${nome.get(l.campanha_id) ?? "campanha"}: de ${dm(l.janela_inicio)}${l.janela_fim ? ` a ${dm(l.janela_fim)}` : ""}; ${env} enviados, ${n.responderam ?? 0} responderam, ${n.orcamentos ?? 0} orçamentos, ${n.fecharam ?? 0} vendas, descadastro ${desc}%${desc > LIMITE_DESCADASTRO_PCT ? ` (ACIMA DE ${LIMITE_DESCADASTRO_PCT}%)` : ""}`;
  });
}

/**
 * Faz a análise da semana e grava o recado (comercial_relatorios, tipo base_parada). Sem leads
 * parados, não chama a IA e não grava nada.
 */
export async function analisarBaseParada(
  db: Db,
  empresaId: string,
  agora: Date,
  dia: string,
): Promise<{ id: string; custo: number; total: number } | { total: 0 }> {
  const parados = await leadsParados(db, empresaId, agora);
  if (!parados.length) return { total: 0 };
  const porGrupo = new Map<GrupoBase, LeadParado[]>();
  for (const p of parados) porGrupo.set(p.grupo, [...(porGrupo.get(p.grupo) ?? []), p]);
  const contagem = Object.fromEntries(
    GRUPOS_BASE.map((g) => [g, porGrupo.get(g)?.length ?? 0]),
  ) as Record<GrupoBase, number>;
  const quantos = amostraProporcional(contagem, AMOSTRA_BASE);
  const amostra = GRUPOS_BASE.flatMap((g) => sortear(porGrupo.get(g) ?? [], quantos[g]));
  const [conversas, campanhas, { data: emp }] = await Promise.all([
    conversasDaAmostra(
      db,
      empresaId,
      amostra.map((a) => a.id),
    ),
    campanhasRecentes(db, empresaId, agora).catch(() => []),
    db.from("empresas").select("nome").eq("id", empresaId).maybeSingle(),
  ]);
  const empresaNome = (emp as { nome?: string } | null)?.nome ?? "empresa";
  const blocos = GRUPOS_BASE.filter((g) => contagem[g] > 0).map((g) => {
    const lidos = amostra.filter((a) => a.grupo === g);
    return [
      `## ${NOME_GRUPO_BASE[g]} (grupo ${g}): ${contagem[g]} leads; amostra de ${lidos.length}`,
      ...lidos.map((a) => `### final ${a.fim}\n${conversas.get(a.id) ?? "(sem mensagens)"}`),
    ].join("\n");
  });
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { chamarIa } = await import("@/lib/alice/parada-ia.server");
  const resp = await chamarIa(() =>
    new Anthropic({ timeout: 280_000, maxRetries: 1 }).messages.create({
      model: MODELO_OPUS,
      max_tokens: 12_000,
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: ESQUEMA_BASE_PARADA as unknown as Record<string, unknown>,
        },
      },
      system: instrucoesBaseParada(empresaNome),
      messages: [
        {
          role: "user",
          content: [
            `BASE PARADA EM ${dia}: ${parados.length} leads.`,
            "",
            campanhas.length
              ? `CAMPANHAS DOS ÚLTIMOS 60 DIAS:\n${campanhas.join("\n")}`
              : "CAMPANHAS DOS ÚLTIMOS 60 DIAS: nenhuma.",
            "",
            ...blocos,
          ].join("\n"),
        },
      ],
    }),
  );
  if (resp.stop_reason !== "end_turn") throw new Error(`base parada: ${resp.stop_reason}`);
  const r = JSON.parse(resp.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as {
    resumo?: string;
    grupos?: Array<{
      grupo: GrupoBase;
      recomendacao: Recomendacao;
      texto: string;
      exemplos: string[];
    }>;
    campanha?: DadosBaseParada["campanha"];
  };
  const custo = custoUsd(resp.usage, PRECO_OPUS);
  const vistos = new Set<GrupoBase>();
  const grupos = (r.grupos ?? [])
    .filter(
      (x) =>
        x &&
        GRUPOS_BASE.includes(x.grupo) &&
        contagem[x.grupo] > 0 &&
        RECOMENDACOES.includes(x.recomendacao) &&
        !vistos.has(x.grupo) &&
        vistos.add(x.grupo),
    )
    .map((x) => ({
      grupo: x.grupo,
      leads: contagem[x.grupo],
      recomendacao: x.recomendacao,
      texto: String(x.texto ?? "")
        .trim()
        .slice(0, 900),
      exemplos: exemplosValidos(
        x.exemplos ?? [],
        new Set(amostra.filter((a) => a.grupo === x.grupo).map((a) => a.fim)),
      ),
    }))
    .sort((a, b) => GRUPOS_BASE.indexOf(a.grupo) - GRUPOS_BASE.indexOf(b.grupo));
  const dados: DadosBaseParada = {
    tipo: TIPO_BASE_PARADA,
    dia,
    total: parados.length,
    lidos: amostra.length,
    resumo: String(r.resumo ?? "")
      .trim()
      .slice(0, 600),
    grupos,
    campanha: {
      vale: Boolean(r.campanha?.vale),
      publico: String(r.campanha?.publico ?? "").slice(0, 300),
      oferta: String(r.campanha?.oferta ?? "").slice(0, 300),
      quando: String(r.campanha?.quando ?? "").slice(0, 120),
      porque: String(r.campanha?.porque ?? "").slice(0, 600),
    },
  };
  const { data: rel, error } = await db
    .from("comercial_relatorios")
    .insert({
      empresa_id: empresaId,
      periodo: `Base parada · ${dia.slice(8, 10)}/${dia.slice(5, 7)}`,
      dados,
      modelo: MODELO_OPUS,
      tokens_entrada: resp.usage.input_tokens,
      tokens_saida: resp.usage.output_tokens,
      custo_usd: custo,
    })
    .select("id")
    .single();
  if (error) throw new Error(`base parada: ${error.message}`);
  return { id: (rel as { id: string }).id, custo, total: parados.length };
}

/**
 * Domingo, na janela da revisão semanal: uma análise por empresa por semana (uma empresa por
 * passada, para não estourar o tempo). Já feita no dia: pula.
 */
export async function rodarBasesParadas(
  db: Db,
  empresas: string[],
  agora: Date,
  hojeSP: string,
): Promise<Record<string, unknown>> {
  const saida: Record<string, unknown> = {};
  for (const emp of empresas) {
    const { count } = await db
      .from("comercial_relatorios")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", emp)
      .eq("dados->>tipo", TIPO_BASE_PARADA)
      .eq("dados->>dia", hojeSP);
    if ((count ?? 0) > 0) continue;
    saida[`base_parada_${emp.slice(0, 8)}`] = await analisarBaseParada(
      db,
      emp,
      agora,
      hojeSP,
    ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
    break;
  }
  return saida;
}
