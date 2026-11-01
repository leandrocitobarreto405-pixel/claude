/**
 * Tatiana, gerente do mês, etapa 2 (servidor): plano de ação do dia. De manhã (8h20–8h40, depois
 * dos alertas) a Tatiana junta os números do mês, as listas do Marketing com tamanho, os modelos
 * e as regras (desconto máximo, trava, dias de disparo) e pede ao Sonnet de 1 a 3 ações; cada uma
 * ganha custo e venda esperada pelo histórico. "Aprovar" cria um rascunho no Marketing pela mesma
 * validação da tela "Nova campanha"; o envio continua só pelo "Ativar" de lá.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { validarNovaCampanha } from "@/lib/campanha-nova";
import { resumoCurto, type NumerosCampanha } from "./campanhas";
import { MODELO_FICHA, custoUsd } from "./ficha";
import { calcularMes, type MesTatiana } from "./mes.server";
import {
  ESQUEMA_PLANO,
  entradaDaAcao,
  instrucoesPlano,
  limiteDeDesconto,
  montarAcao,
  opcoesDeContagem,
  rotuloDaLista,
  taxasHistoricas,
  textoPushPlano,
  type AcaoIA,
  type AcaoPlano,
  type Contagem,
} from "./plano";
import { OPCOES_LISTAS, modeloSugerido } from "@/lib/campanha-nova";

type Db = SupabaseClient;

export type PlanoTatiana = {
  id: string;
  dia: string;
  leitura: string | null;
  acoes: AcaoPlano[];
  contexto: {
    falta: number | null;
    diasUteisRestantes: number;
    ritmoNecessario: number | null;
    diasVazios: string[];
    alertas: number;
    taxasHistoricas: boolean;
    limitePct: number;
    travaDias: number;
  };
  custoUsd: number;
  criadoEm: string;
};

type Linha = {
  id: string;
  dia: string;
  leitura: string | null;
  acoes: AcaoPlano[];
  contexto: PlanoTatiana["contexto"];
  custo_usd: number | string;
  criado_em: string;
};

function paraTela(l: Linha): PlanoTatiana {
  return {
    id: l.id,
    dia: l.dia,
    leitura: l.leitura,
    acoes: l.acoes ?? [],
    contexto: l.contexto,
    custoUsd: Number(l.custo_usd ?? 0),
    criadoEm: l.criado_em,
  };
}

/** Último plano da empresa (hoje ou o mais recente). */
export async function planoAtual(db: Db, emp: string): Promise<PlanoTatiana | null> {
  const { data } = await db
    .from("comercial_planos")
    .select("id, dia, leitura, acoes, contexto, custo_usd, criado_em")
    .eq("empresa_id", emp)
    .order("dia", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? paraTela(data as Linha) : null;
}

async function contagens(db: Db, emp: string): Promise<Record<string, Contagem>> {
  const { data, error } = await db.rpc("comercial_listas_contagem", {
    _empresa: emp,
    _opcoes: opcoesDeContagem(),
  });
  if (error) throw new Error(`contar as listas: ${error.message}`);
  return (data ?? {}) as Record<string, Contagem>;
}

async function textoDosModelos(db: Db, emp: string, nomes: string[]): Promise<Map<string, string>> {
  const saida = new Map<string, string>();
  if (!nomes.length) return saida;
  const { data } = await db
    .from("modelos_rascunhos")
    .select("template_nome, form")
    .eq("empresa_id", emp)
    .in("template_nome", nomes)
    .limit(20);
  for (const m of (data ?? []) as Array<{ template_nome: string; form: Record<string, unknown> }>)
    saida.set(m.template_nome, String(m.form?.["corpo"] ?? "").slice(0, 600));
  return saida;
}

/** Campanhas abertas no Marketing (rascunho a enviando) e as listas que elas usam. */
async function campanhasAbertas(
  db: Db,
  emp: string,
): Promise<Array<{ nome: string; grupos: string[] }>> {
  const { data } = await db
    .from("mkt_campanhas")
    .select("nome, grupos, status")
    .eq("empresa_id", emp)
    .eq("tipo", "calendario")
    .in("status", ["rascunho", "aguardando_aprovacao", "aprovada", "enviando", "pausada"])
    .limit(50);
  return ((data ?? []) as Array<{ nome: string; grupos: string[] | null }>).map((k) => ({
    nome: k.nome,
    grupos: k.grupos ?? [],
  }));
}

async function ticketMedio(db: Db, emp: string): Promise<number> {
  const { data } = await db
    .from("comercial_analises")
    .select("valor_vendido")
    .eq("empresa_id", emp)
    .eq("status", "ok")
    .eq("resultado", "vendeu")
    .not("valor_vendido", "is", null)
    .order("analisado_em", { ascending: false })
    .limit(100);
  const v = ((data ?? []) as Array<{ valor_vendido: number | string }>).map((x) =>
    Number(x.valor_vendido),
  );
  const soma = v.reduce((s, x) => s + x, 0);
  return v.length >= 5 ? Math.round((soma / v.length) * 100) / 100 : 450;
}

const brl = (v: number | null) =>
  v === null
    ? "—"
    : `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/** Gera (ou devolve) o plano do dia da empresa. */
export async function gerarPlano(
  db: Db,
  emp: string,
  hoje: string,
  diasUteis: number[],
  mesPronto?: MesTatiana,
): Promise<{ plano: PlanoTatiana; novo: boolean }> {
  const { data: ja } = await db
    .from("comercial_planos")
    .select("id, dia, leitura, acoes, contexto, custo_usd, criado_em")
    .eq("empresa_id", emp)
    .eq("dia", hoje)
    .maybeSingle();
  if (ja) return { plano: paraTela(ja as Linha), novo: false };

  const m = mesPronto ?? (await calcularMes(db, emp, hoje, diasUteis));
  const [{ data: cfg }, { data: ag }, { data: ia }, { data: empresa }, cont, abertas, ticket] =
    await Promise.all([
      db
        .from("mkt_configuracoes")
        .select("custo_msg_estimado, dias_disparo, modelos, limite_marketing_dias, hora_disparo")
        .eq("empresa_id", emp)
        .maybeSingle(),
      db
        .from("agenda_configuracoes")
        .select("promo_desconto_pct")
        .eq("empresa_id", emp)
        .maybeSingle(),
      db
        .from("ia_configuracoes")
        .select("oferta_followup_ligada, oferta_followup_tipo, oferta_followup_valor")
        .eq("empresa_id", emp)
        .maybeSingle(),
      db.from("empresas").select("nome").eq("id", emp).maybeSingle(),
      contagens(db, emp),
      campanhasAbertas(db, emp),
      ticketMedio(db, emp),
    ]);
  const c = cfg as {
    custo_msg_estimado?: number | string;
    dias_disparo?: number[] | null;
    modelos?: unknown;
    limite_marketing_dias?: number;
    hora_disparo?: number;
  } | null;
  const custoMsg = Number(c?.custo_msg_estimado ?? 0.32);
  const diasDisparo = (c?.dias_disparo ?? [2, 3, 4]).map(Number);
  const travaDias = Number(c?.limite_marketing_dias ?? 30);
  const iaCfg = ia as {
    oferta_followup_ligada?: boolean;
    oferta_followup_tipo?: "pct" | "reais";
    oferta_followup_valor?: number | string | null;
  } | null;
  const limitePct = limiteDeDesconto({
    ofertaLigada: Boolean(iaCfg?.oferta_followup_ligada),
    ofertaTipo: iaCfg?.oferta_followup_tipo === "reais" ? "reais" : "pct",
    ofertaValor:
      iaCfg?.oferta_followup_valor === null || iaCfg?.oferta_followup_valor === undefined
        ? null
        : Number(iaCfg.oferta_followup_valor),
    promoPct:
      (ag as { promo_desconto_pct?: number | string } | null)?.promo_desconto_pct === undefined
        ? null
        : Number((ag as { promo_desconto_pct?: number | string }).promo_desconto_pct),
  });
  const { data: hist } = await db
    .from("comercial_campanhas")
    .select("numeros, encerrada, mkt_campanhas(nome)")
    .eq("empresa_id", emp)
    .order("janela_inicio", { ascending: false })
    .limit(8);
  const historico = (
    (hist ?? []) as unknown as Array<{
      numeros: NumerosCampanha | Record<string, never>;
      encerrada: boolean;
      mkt_campanhas: { nome: string } | null;
    }>
  ).filter((h) => "enviados" in h.numeros);
  const taxas = taxasHistoricas(
    historico.filter((h) => h.encerrada).map((h) => h.numeros as NumerosCampanha),
    ticket,
  );
  const modelosNomes = [...new Set(OPCOES_LISTAS.map((o) => modeloSugerido(o.grupo, c?.modelos)))];
  const textos = await textoDosModelos(db, emp, modelosNomes).catch(
    () => new Map<string, string>(),
  );

  const publicos = OPCOES_LISTAS.flatMap((o) => {
    const faixas = o.faixas ? o.faixas.map((f) => f.valor) : [null];
    return faixas.map((f) => {
      const chave = f === null ? o.grupo : `${o.grupo}:${f}`;
      const n = cont[chave] ?? { total: 0, podem: 0 };
      const modelo = modeloSugerido(o.grupo, c?.modelos);
      return `- ${o.grupo}${f ? ` faixa ${f}` : ""} = ${rotuloDaLista(o.grupo, f)}: ${n.total} pessoas, ${n.podem} podem receber agora; modelo ${modelo}${textos.get(modelo) ? ` ("${textos.get(modelo)}")` : ""}`;
    });
  });

  const conteudo = [
    `HOJE: ${hoje}. Dias de disparo da empresa (1 = segunda): ${diasDisparo.join(", ")}; hora padrão ${c?.hora_disparo ?? 10}h. Custo por mensagem R$ ${custoMsg.toFixed(2)}.`,
    "",
    "MÊS:",
    `- Meta ${brl(m.meta.meta)}; serviço no mês ${brl(m.meta.vendidoServico)}; fechado no mês ${brl(m.meta.vendidoVenda)}; falta ${brl(m.meta.falta)}; ${m.meta.diasUteisRestantes} dias úteis; precisa ${brl(m.meta.ritmoNecessario)} por dia útil; ritmo atual ${brl(m.meta.ritmoAtual)}.`,
    `- Previsão pelos orçamentos abertos: ${brl(m.previsao.total)} (chega a ${brl(m.previsao.chegaA)}).`,
    `- Agenda: ${m.agenda.livres} de ${m.agenda.base} horários livres até o fim do mês; dias vazios: ${m.agenda.vazios.map((d) => d.data).join(", ") || "nenhum"}.`,
    `- Alertas: ${m.alertas.map((a) => a.titulo).join("; ") || "nenhum"}.`,
    `- Leads por origem (7 dias × média 4 semanas): ${m.leadsPorOrigem.map((l) => `${l.origem} ${l.atual}×${l.media4}`).join("; ")}.`,
    `- Objeções (14 dias): ${m.objecoes.map((o) => `${o.nome} ${o.n}`).join(", ") || "nenhuma"}.`,
    "",
    "PÚBLICOS (listas do Marketing):",
    ...publicos,
    "",
    `CAMPANHAS ABERTAS NO MARKETING (não repetir a lista): ${abertas.map((k) => `${k.nome} [${k.grupos.join(",")}]`).join("; ") || "nenhuma"}.`,
    `HISTÓRICO: taxa de resposta ${Math.round(taxas.resposta * 100)}%, taxa de venda ${(taxas.venda * 100).toFixed(1)}%, ticket ${brl(taxas.ticket)}${taxas.historicas ? " (campanhas da empresa)" : " (padrão, poucas campanhas acompanhadas)"}.`,
    ...historico
      .slice(0, 5)
      .map(
        (h) =>
          `- ${h.mkt_campanhas?.nome ?? "campanha"}: ${resumoCurto(h.numeros as NumerosCampanha)}`,
      ),
    "",
    `REGRAS: desconto máximo ${limitePct}%; trava de ${travaDias} dias; descadastro automático.`,
  ].join("\n");

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { chamarIa } = await import("@/lib/alice/parada-ia.server");
  const resp = await chamarIa(() =>
    new Anthropic({ timeout: 120_000, maxRetries: 1 }).messages.create({
      model: MODELO_FICHA,
      max_tokens: 3_000,
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: ESQUEMA_PLANO as unknown as Record<string, unknown>,
        },
      },
      system: instrucoesPlano(
        (empresa as { nome?: string } | null)?.nome ?? "empresa",
        limitePct,
        travaDias,
      ),
      messages: [{ role: "user", content: conteudo }],
    }),
  );
  if (resp.stop_reason !== "end_turn") throw new Error(`plano: ${resp.stop_reason}`);
  const r = JSON.parse(resp.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as {
    leitura?: string;
    acoes?: AcaoIA[];
  };
  const acoes: AcaoPlano[] = [];
  for (const a of (r.acoes ?? []).slice(0, 3)) {
    const feita = montarAcao(a, acoes.length, {
      hoje,
      contagens: cont,
      modelosDaEmpresa: c?.modelos,
      custoMsg,
      taxas,
      limitePct,
      diasDisparo,
    });
    if (feita && feita.tamanho.podem > 0) acoes.push(feita);
  }
  const contexto: PlanoTatiana["contexto"] = {
    falta: m.meta.falta,
    diasUteisRestantes: m.meta.diasUteisRestantes,
    ritmoNecessario: m.meta.ritmoNecessario,
    diasVazios: m.agenda.vazios.map((d) => d.data),
    alertas: m.alertas.length,
    taxasHistoricas: taxas.historicas,
    limitePct,
    travaDias,
  };
  const custo = custoUsd(resp.usage);
  const { data: salvo, error } = await db
    .from("comercial_planos")
    .upsert(
      {
        empresa_id: emp,
        dia: hoje,
        contexto,
        acoes,
        leitura:
          String(r.leitura ?? "")
            .trim()
            .slice(0, 600) || null,
        modelo: MODELO_FICHA,
        tokens_entrada: resp.usage.input_tokens,
        tokens_saida: resp.usage.output_tokens,
        custo_usd: custo,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "empresa_id,dia" },
    )
    .select("id, dia, leitura, acoes, contexto, custo_usd, criado_em")
    .single();
  if (error || !salvo) throw new Error(`gravar o plano: ${error?.message ?? "sem retorno"}`);
  return { plano: paraTela(salvo as Linha), novo: true };
}

/**
 * 8h20–8h40 (São Paulo), empresas com a Tatiana ligada: plano do dia (uma vez por dia) e aviso ao
 * admin (app + push) quando houver ação para aprovar.
 */
export async function rodarPlanoDaTatiana(
  db: Db,
  configs: Array<{ empresa_id: string; dias_uteis: number[] | null }>,
  hojeSP: string,
  horaSP: string,
): Promise<Record<string, unknown>> {
  if (horaSP < "08:20" || horaSP >= "08:40") return {};
  const saida: Record<string, unknown> = {};
  for (const cfg of configs) {
    const emp = cfg.empresa_id;
    try {
      const { plano, novo } = await gerarPlano(
        db,
        emp,
        hojeSP,
        cfg.dias_uteis ?? [1, 2, 3, 4, 5, 6],
      );
      if (!novo) continue;
      let pushes = 0;
      if (plano.acoes.length) {
        const referencia = `gerente_plano:${hojeSP}`;
        const { data: ja } = await db
          .from("mkt_avisos")
          .select("id")
          .eq("empresa_id", emp)
          .eq("referencia", referencia)
          .limit(1);
        const t = textoPushPlano(plano.acoes);
        if (!ja?.length)
          await db.from("mkt_avisos").insert({
            empresa_id: emp,
            tipo: "gerente_plano",
            titulo: t.titulo,
            mensagem: `${t.corpo}. Aprovar ou recusar na tela da Tatiana, aba Mês.`,
            so_no_app: true,
            referencia,
          });
        const { pessoasComCelular, enviarParaPessoa, registrarUmaVez } =
          await import("@/lib/push/notificacoes.server");
        const { querReceber } = await import("@/lib/push/notificacoes");
        const pessoas = ((await pessoasComCelular(db as never, emp)).get(emp) ?? []).filter(
          (p) => p.papel === "admin" && querReceber("alerta_gerente", p.papel, p.pref),
        );
        for (const p of pessoas) {
          const id = await registrarUmaVez(
            db as never,
            emp,
            p.userId,
            "alerta_gerente",
            `plano:${hojeSP}`,
            t.titulo,
          );
          if (!id) continue;
          const r = await enviarParaPessoa(db as never, p.celulares, {
            ...t,
            url: "/gerente-comercial?aba=mes",
            tag: `tatiana-plano-${hojeSP}`,
          });
          pushes += r.enviados;
        }
      }
      saida[`plano_${emp.slice(0, 8)}`] = {
        acoes: plano.acoes.length,
        custoUsd: plano.custoUsd,
        pushes,
      };
    } catch (e) {
      saida[`plano_${emp.slice(0, 8)}`] = { erro: e instanceof Error ? e.message : String(e) };
    }
  }
  return saida;
}

// ---------------------------------------------------------------- decisões do admin

async function planoDaEmpresa(db: Db, emp: string, planoId: string): Promise<Linha> {
  const { data } = await db
    .from("comercial_planos")
    .select("id, dia, leitura, acoes, contexto, custo_usd, criado_em")
    .eq("id", planoId)
    .eq("empresa_id", emp)
    .maybeSingle();
  if (!data) throw new Error("Plano não encontrado.");
  return data as Linha;
}

async function gravarAcoes(db: Db, planoId: string, acoes: AcaoPlano[]) {
  const { error } = await db
    .from("comercial_planos")
    .update({ acoes, atualizado_em: new Date().toISOString() })
    .eq("id", planoId);
  if (error) throw new Error(error.message);
}

/** Aprova uma ação: cria o rascunho no Marketing (mesma validação da tela) e marca a decisão. */
export async function aprovarAcao(
  db: Db,
  o: {
    empresaId: string;
    userId: string;
    planoId: string;
    indice: number;
    hoje: string;
    agora: string;
  },
): Promise<{ campanhaId: string }> {
  const plano = await planoDaEmpresa(db, o.empresaId, o.planoId);
  const acoes = [...(plano.acoes ?? [])];
  const a = acoes[o.indice];
  if (!a) throw new Error("Ação não encontrada.");
  if (a.status !== "sugerida") throw new Error("Esta ação já foi decidida.");
  const { data: cfg } = await db
    .from("mkt_configuracoes")
    .select("dias_disparo, custo_msg_estimado")
    .eq("empresa_id", o.empresaId)
    .maybeSingle();
  const c = cfg as { dias_disparo?: number[] | null; custo_msg_estimado?: number | string } | null;
  const entrada = entradaDaAcao(a);
  // Data já passada (plano antigo): empurra para a próxima data válida.
  if (entrada.datas[0]! <= o.hoje) {
    const { proximaDataDisparo } = await import("./plano");
    entrada.datas = [
      proximaDataDisparo(
        o.hoje,
        1,
        (c?.dias_disparo ?? [2, 3, 4]).map(Number),
        a.horaInicio !== null,
      ),
    ];
  }
  const r = validarNovaCampanha(entrada, {
    hoje: o.hoje,
    dias: (c?.dias_disparo ?? [2, 3, 4]).map(Number),
    agora: o.agora,
  });
  if (!r.ok) throw new Error(r.problemas.join(" "));
  const { inserirCampanhaRascunho } = await import("@/lib/mkt/campanhas.server");
  const campanhaId = await inserirCampanhaRascunho(db, {
    empresaId: o.empresaId,
    userId: o.userId,
    campanha: r.campanha,
    custoMsg: Number(c?.custo_msg_estimado ?? 0.32),
    repeteDe: null,
  });
  acoes[o.indice] = {
    ...a,
    data: entrada.datas[0]!,
    status: "aprovada",
    campanhaId,
    decididoEm: new Date().toISOString(),
    decididoPor: o.userId,
    motivo: null,
  };
  await gravarAcoes(db, o.planoId, acoes);
  return { campanhaId };
}

export async function recusarAcao(
  db: Db,
  o: { empresaId: string; userId: string; planoId: string; indice: number; motivo: string | null },
): Promise<void> {
  const plano = await planoDaEmpresa(db, o.empresaId, o.planoId);
  const acoes = [...(plano.acoes ?? [])];
  const a = acoes[o.indice];
  if (!a) throw new Error("Ação não encontrada.");
  if (a.status !== "sugerida") throw new Error("Esta ação já foi decidida.");
  acoes[o.indice] = {
    ...a,
    status: "recusada",
    decididoEm: new Date().toISOString(),
    decididoPor: o.userId,
    motivo: o.motivo,
  };
  await gravarAcoes(db, o.planoId, acoes);
}
