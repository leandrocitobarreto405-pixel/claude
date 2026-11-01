/**
 * Tatiana, desempenho de campanha (servidor). Toda noite, para cada campanha de WhatsApp enviada
 * nos últimos 45 dias: números da janela de 7 dias, classe de cada resposta (botão/descadastro
 * pelo sistema; o resto pelo Haiku, em lote) e, quando a janela fecha, 2–3 sugestões (Sonnet)
 * para a próxima campanha. Só grava em comercial_campanhas; nada é enviado a clientes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ESQUEMA_CLASSES,
  ESQUEMA_SUGESTOES,
  JANELA_DIAS,
  classePeloSistema,
  instrucoesClasses,
  instrucoesSugestoes,
  janelaDaCampanha,
  numerosDaCampanha,
  resumoCurto,
  resumoDasClasses,
  type ClasseResposta,
  type EnvioCampanha,
  type NumerosCampanha,
  type Sugestao,
} from "./campanhas";
import { MODELO_FICHA, MODELO_HAIKU, PRECO_HAIKU, custoUsd } from "./ficha";
import { finalDoTelefone } from "./tatiana";

type Db = SupabaseClient;

/** Campanhas com o primeiro envio até 45 dias atrás entram (cobre as já enviadas). */
const OLHAR_DIAS = 45;
/** Orçamentos e vendas ligados pelo marketing contam até 30 dias depois do envio. */
const ATUALIZAR_DIAS = 30;
const LOTE_CLASSES = 60;
const MAX_EXEMPLOS = 15;

export type RespostasCampanha = {
  por_envio: Record<string, ClasseResposta>;
  /** Respostas sem texto encontrado (áudio sem transcrição, contato não achado). */
  sem_texto: number;
  exemplos: Array<{ classe: ClasseResposta; texto: string }>;
};

type Campanha = {
  id: string;
  nome: string;
  tipo: string;
  tema: string | null;
  templates: Record<string, string> | null;
  template_nome: string | null;
  listas: unknown;
  grupos: string[] | null;
  datas_disparo: string[] | null;
  hora_inicio: string | null;
  condicao_texto: string | null;
  condicao_pct: number | string | null;
  custo_msg_estimado: number | string;
  status: string;
};
type Linha = {
  id: string;
  campanha_id: string;
  janela_inicio: string;
  janela_fim: string;
  encerrada: boolean;
  numeros: NumerosCampanha | Record<string, never>;
  respostas: Partial<RespostasCampanha>;
  sugestoes: Sugestao[] | null;
  leitura: string | null;
  custo_usd: number | string;
};
type EnvioDb = {
  id: string;
  status: string;
  enviado_em: string | null;
  respondido_em: string | null;
  botao_clicado: string | null;
  quote_id: string | null;
  work_order_id: string | null;
  valor_venda: number | string | null;
  bloqueio: boolean;
  crm_lead_id: string | null;
  normalized_phone: string;
  mkt_contatos: { optout_em: string | null } | null;
};

function paraEnvio(e: EnvioDb): EnvioCampanha {
  return {
    id: e.id,
    status: e.status,
    enviadoEm: e.enviado_em,
    respondidoEm: e.respondido_em,
    botaoClicado: e.botao_clicado,
    quoteId: e.quote_id,
    workOrderId: e.work_order_id,
    valorVenda: e.valor_venda === null ? null : Number(e.valor_venda),
    bloqueio: Boolean(e.bloqueio),
    optoutEm: e.mkt_contatos?.optout_em ?? null,
  };
}

/** Primeira mensagem do cliente depois do envio (texto ou transcrição), por envio. */
async function textosDasRespostas(
  db: Db,
  empresaId: string,
  janela: { inicio: string; fim: string },
  envios: EnvioDb[],
): Promise<Map<string, string>> {
  const saida = new Map<string, string>();
  if (!envios.length) return saida;
  type Msg = {
    crm_lead_id: string | null;
    whatsapp_contact_id: string | null;
    text_content: string | null;
    transcricao: string | null;
    message_timestamp: string;
  };
  const texto = (m: Msg) => (m.text_content ?? m.transcricao ?? "").trim();
  const ate = new Date(Date.parse(janela.fim) + 60_000).toISOString();
  const comLead = envios.filter((e) => e.crm_lead_id);
  for (let i = 0; i < comLead.length; i += 200) {
    const parte = comLead.slice(i, i + 200);
    const { data } = await db
      .from("whatsapp_messages")
      .select("crm_lead_id, whatsapp_contact_id, text_content, transcricao, message_timestamp")
      .eq("empresa_id", empresaId)
      .eq("direction", "Recebida")
      .eq("privada", false)
      .in(
        "crm_lead_id",
        parte.map((e) => e.crm_lead_id as string),
      )
      .gte("message_timestamp", janela.inicio)
      .lte("message_timestamp", ate)
      .order("message_timestamp")
      .limit(4000);
    for (const e of parte) {
      const m = ((data ?? []) as Msg[]).find(
        (x) =>
          x.crm_lead_id === e.crm_lead_id &&
          e.enviado_em !== null &&
          x.message_timestamp >= e.enviado_em &&
          texto(x),
      );
      if (m) saida.set(e.id, texto(m));
    }
  }
  // Sem lead ligado ao envio: acha o contato pelo final do telefone (poucos; até 30 por noite).
  for (const e of envios.filter((x) => !x.crm_lead_id).slice(0, 30)) {
    const fim = finalDoTelefone(e.normalized_phone);
    if (fim.length < 8 || !e.enviado_em) continue;
    const { data: cts } = await db
      .from("whatsapp_contacts")
      .select("id")
      .eq("empresa_id", empresaId)
      .like("normalized_phone", `%${fim}`)
      .limit(3);
    const ids = ((cts ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (!ids.length) continue;
    const { data: ms } = await db
      .from("whatsapp_messages")
      .select("crm_lead_id, whatsapp_contact_id, text_content, transcricao, message_timestamp")
      .eq("empresa_id", empresaId)
      .eq("direction", "Recebida")
      .eq("privada", false)
      .in("whatsapp_contact_id", ids)
      .gte("message_timestamp", e.enviado_em)
      .lte("message_timestamp", ate)
      .order("message_timestamp")
      .limit(5);
    const m = ((ms ?? []) as Msg[]).find((x) => texto(x));
    if (m) saida.set(e.id, texto(m));
  }
  return saida;
}

/** Classe de cada resposta pelo Haiku, em lotes. Devolve só as que o modelo classificou. */
async function classificarPorIa(
  itens: Array<{ id: string; texto: string }>,
): Promise<{ classes: Map<string, ClasseResposta>; custoUsd: number }> {
  const classes = new Map<string, ClasseResposta>();
  let custo = 0;
  if (!itens.length) return { classes, custoUsd: 0 };
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { chamarIa } = await import("@/lib/alice/parada-ia.server");
  for (let i = 0; i < itens.length; i += LOTE_CLASSES) {
    const lote = itens.slice(i, i + LOTE_CLASSES);
    const resp = await chamarIa(() =>
      new Anthropic({ timeout: 60_000, maxRetries: 1 }).messages.create({
        model: MODELO_HAIKU,
        max_tokens: 2_000,
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: ESQUEMA_CLASSES as unknown as Record<string, unknown>,
          },
        },
        system: instrucoesClasses(),
        messages: [
          {
            role: "user",
            content: lote
              .map((it, n) => `${n + 1}. ${it.texto.replace(/\s+/g, " ").slice(0, 240)}`)
              .join("\n"),
          },
        ],
      }),
    );
    custo += custoUsd(resp.usage, PRECO_HAIKU);
    if (resp.stop_reason !== "end_turn") continue;
    const r = JSON.parse(resp.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as {
      classes?: Array<{ n: number; classe: ClasseResposta }>;
    };
    for (const c of r.classes ?? []) {
      const it = lote[c.n - 1];
      if (it && c.classe) classes.set(it.id, c.classe);
    }
  }
  return { classes, custoUsd: custo };
}

/** Corpo dos modelos da campanha, se a empresa guardou o texto no Nexa (rascunhos). */
async function textoDosModelos(db: Db, empresaId: string, nomes: string[]): Promise<string[]> {
  if (!nomes.length) return [];
  const { data } = await db
    .from("modelos_rascunhos")
    .select("template_nome, form")
    .eq("empresa_id", empresaId)
    .in("template_nome", nomes)
    .limit(10);
  return ((data ?? []) as Array<{ template_nome: string; form: Record<string, unknown> }>).map(
    (m) => {
      const f = m.form ?? {};
      const corpo = String(f["corpo"] ?? f["body"] ?? f["texto"] ?? "").slice(0, 1200);
      return `${m.template_nome}: ${corpo || "(sem texto guardado)"}`;
    },
  );
}

function descricaoDaCampanha(k: Campanha): string {
  const modelos = [
    ...Object.values(k.templates ?? {}),
    ...(k.template_nome ? [k.template_nome] : []),
  ].filter(Boolean);
  const oferta =
    (k.condicao_texto ?? "").trim() ||
    (k.condicao_pct && Number(k.condicao_pct) > 0 ? `${k.condicao_pct}% de desconto` : "") ||
    "sem oferta declarada";
  const publico = k.listas
    ? JSON.stringify(k.listas).slice(0, 600)
    : (k.grupos ?? []).join(", ") || "não informado";
  return [
    `Nome: ${k.nome}`,
    `Tema: ${k.tema ?? "não informado"}`,
    `Modelos (Meta): ${[...new Set(modelos)].join(", ") || "não informado"}`,
    `Oferta: ${oferta}`,
    `Público (listas/grupos): ${publico}`,
    `Datas de envio: ${(k.datas_disparo ?? []).join(", ") || "não informado"}; hora de início: ${k.hora_inicio ?? "padrão da empresa"}`,
  ].join("\n");
}

/** Sugestões do Sonnet no fim da janela. */
async function sugerirProxima(
  db: Db,
  empresaId: string,
  empresaNome: string,
  k: Campanha,
  numeros: NumerosCampanha,
  respostas: RespostasCampanha,
  anteriores: Array<{ nome: string; numeros: NumerosCampanha }>,
): Promise<{ leitura: string; sugestoes: Sugestao[]; custoUsd: number }> {
  const nomes = [
    ...new Set([
      ...Object.values(k.templates ?? {}),
      ...(k.template_nome ? [k.template_nome] : []),
    ]),
  ].filter(Boolean);
  const modelos = await textoDosModelos(db, empresaId, nomes).catch(() => []);
  const classes = resumoDasClasses(respostas.por_envio);
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { chamarIa } = await import("@/lib/alice/parada-ia.server");
  const resp = await chamarIa(() =>
    new Anthropic({ timeout: 120_000, maxRetries: 1 }).messages.create({
      model: MODELO_FICHA,
      max_tokens: 2_500,
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: ESQUEMA_SUGESTOES as unknown as Record<string, unknown>,
        },
      },
      system: instrucoesSugestoes(empresaNome),
      messages: [
        {
          role: "user",
          content: [
            "CAMPANHA:",
            descricaoDaCampanha(k),
            modelos.length ? `Texto dos modelos:\n${modelos.join("\n")}` : "",
            "",
            `NÚMEROS (${JANELA_DIAS} dias): ${resumoCurto(numeros)}`,
            JSON.stringify(numeros),
            "",
            `RESPOSTAS POR CLASSE: ${classes.map((c) => `${c.nome} ${c.n}`).join(" · ") || "nenhuma"}${respostas.sem_texto ? ` (sem texto: ${respostas.sem_texto})` : ""}`,
            respostas.exemplos.length
              ? `Trechos de respostas (classe: texto):\n${respostas.exemplos.map((e) => `- ${e.classe}: ${e.texto}`).join("\n")}`
              : "",
            "",
            anteriores.length
              ? `CAMPANHAS ANTERIORES DA EMPRESA:\n${anteriores.map((a) => `- ${a.nome}: ${resumoCurto(a.numeros)}`).join("\n")}`
              : "CAMPANHAS ANTERIORES: nenhuma acompanhada ainda.",
          ]
            .filter((l) => l !== "")
            .join("\n"),
        },
      ],
    }),
  );
  if (resp.stop_reason !== "end_turn") throw new Error(`sugestões: ${resp.stop_reason}`);
  const r = JSON.parse(resp.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as {
    leitura?: string;
    sugestoes?: Sugestao[];
  };
  const sugestoes = (r.sugestoes ?? [])
    .filter((s) => s && s.tipo && s.sugestao)
    .slice(0, 3)
    .map((s) => ({ tipo: s.tipo, sugestao: String(s.sugestao).trim().slice(0, 600) }));
  if (!sugestoes.length) throw new Error("sugestões: resposta vazia");
  return {
    leitura: String(r.leitura ?? "")
      .trim()
      .slice(0, 600),
    sugestoes,
    custoUsd: custoUsd(resp.usage),
  };
}

export type SaidaCampanhas = {
  acompanhadas: number;
  novas: number;
  encerradas: number;
  classificadas: number;
  custoUsd: number;
  erros: string[];
};

/** Uma empresa: atualiza (ou cria) o acompanhamento de cada campanha enviada. */
export async function acompanharCampanhas(
  db: Db,
  empresaId: string,
  agora = new Date(),
): Promise<SaidaCampanhas> {
  const saida: SaidaCampanhas = {
    acompanhadas: 0,
    novas: 0,
    encerradas: 0,
    classificadas: 0,
    custoUsd: 0,
    erros: [],
  };
  const desde = new Date(agora.getTime() - OLHAR_DIAS * 86_400_000).toISOString();
  const [{ data: ks }, { data: ls }, { data: cfg }, { data: emp }] = await Promise.all([
    db
      .from("mkt_campanhas")
      .select(
        "id, nome, tipo, tema, templates, template_nome, listas, grupos, datas_disparo, hora_inicio, condicao_texto, condicao_pct, custo_msg_estimado, status",
      )
      .eq("empresa_id", empresaId)
      .eq("tipo", "calendario")
      .in("status", ["aprovada", "enviando", "pausada", "concluida"])
      .limit(200),
    db
      .from("comercial_campanhas")
      .select(
        "id, campanha_id, janela_inicio, janela_fim, encerrada, numeros, respostas, sugestoes, leitura, custo_usd",
      )
      .eq("empresa_id", empresaId)
      .limit(500),
    db.from("mkt_configuracoes").select("botoes").eq("empresa_id", empresaId).maybeSingle(),
    db.from("empresas").select("nome").eq("id", empresaId).maybeSingle(),
  ]);
  const botoes = ((cfg as { botoes?: Record<string, string> } | null)?.botoes ?? {}) as Record<
    string,
    string
  >;
  const empresaNome = (emp as { nome?: string } | null)?.nome ?? "empresa";
  const linhas = new Map(((ls ?? []) as Linha[]).map((l) => [l.campanha_id, l]));
  const campanhas = (ks ?? []) as Campanha[];
  const nomeDe = new Map(campanhas.map((k) => [k.id, k.nome]));

  for (const k of campanhas) {
    const linha = linhas.get(k.id) ?? null;
    try {
      // Encerrada e fora dos 30 dias: nada muda mais.
      if (
        linha?.encerrada &&
        Date.parse(linha.janela_inicio) + ATUALIZAR_DIAS * 86_400_000 < agora.getTime()
      )
        continue;
      if (!linha) {
        const { data: primeiro } = await db
          .from("mkt_envios")
          .select("enviado_em")
          .eq("campanha_id", k.id)
          .eq("status", "enviado")
          .order("enviado_em")
          .limit(1)
          .maybeSingle();
        const e1 = (primeiro as { enviado_em?: string | null } | null)?.enviado_em ?? null;
        if (!e1 || e1 < desde) continue;
      }
      const { data: envs } = await db
        .from("mkt_envios")
        .select(
          "id, status, enviado_em, respondido_em, botao_clicado, quote_id, work_order_id, valor_venda, bloqueio, crm_lead_id, normalized_phone, mkt_contatos(optout_em)",
        )
        .eq("campanha_id", k.id)
        .in("status", ["enviado", "erro"])
        .limit(5000);
      const enviosDb = (envs ?? []) as unknown as EnvioDb[];
      const envios = enviosDb.map(paraEnvio);
      const janela = janelaDaCampanha(envios);
      if (!janela) continue;
      const numeros = numerosDaCampanha(envios, Number(k.custo_msg_estimado ?? 0), janela.fim);

      // Classes das respostas novas.
      const respostas: RespostasCampanha = {
        por_envio: { ...(linha?.respostas?.por_envio ?? {}) },
        sem_texto: 0,
        exemplos: [...(linha?.respostas?.exemplos ?? [])],
      };
      const fimMs = Date.parse(janela.fim);
      const novas = enviosDb.filter(
        (e) =>
          e.respondido_em && Date.parse(e.respondido_em) <= fimMs && !respostas.por_envio[e.id],
      );
      const precisamTexto: EnvioDb[] = [];
      for (const e of novas) {
        const c = classePeloSistema(paraEnvio(e), botoes);
        if (c) respostas.por_envio[e.id] = c;
        else precisamTexto.push(e);
      }
      let custo = 0;
      if (precisamTexto.length) {
        const textos = await textosDasRespostas(db, empresaId, janela, precisamTexto);
        const itens = precisamTexto
          .filter((e) => textos.has(e.id))
          .map((e) => ({ id: e.id, texto: textos.get(e.id) as string }));
        const ia = await classificarPorIa(itens);
        custo += ia.custoUsd;
        for (const [id, c] of ia.classes) {
          respostas.por_envio[id] = c;
          if (respostas.exemplos.length < MAX_EXEMPLOS)
            respostas.exemplos.push({ classe: c, texto: (textos.get(id) ?? "").slice(0, 160) });
        }
        saida.classificadas += ia.classes.size;
      }
      // Sem texto: só as que ainda ficaram sem classe (contadas, não inventadas).
      respostas.sem_texto = enviosDb.filter(
        (e) =>
          e.respondido_em && Date.parse(e.respondido_em) <= fimMs && !respostas.por_envio[e.id],
      ).length;

      // Fim da janela: leitura e sugestões, uma vez.
      let encerrada = Boolean(linha?.encerrada);
      let sugestoes = linha?.sugestoes ?? null;
      let leitura = linha?.leitura ?? null;
      if (!encerrada && agora.getTime() >= fimMs && numeros.enviados > 0) {
        const anteriores = [...linhas.values()]
          .filter(
            (l) => l.campanha_id !== k.id && l.encerrada && (l.numeros as NumerosCampanha).enviados,
          )
          .map((l) => ({
            nome: nomeDe.get(l.campanha_id) ?? "campanha",
            numeros: l.numeros as NumerosCampanha,
          }))
          .slice(0, 8);
        const s = await sugerirProxima(
          db,
          empresaId,
          empresaNome,
          k,
          numeros,
          respostas,
          anteriores,
        );
        custo += s.custoUsd;
        sugestoes = s.sugestoes;
        leitura = s.leitura;
        encerrada = true;
        saida.encerradas += 1;
      }
      const { error } = await db.from("comercial_campanhas").upsert(
        {
          empresa_id: empresaId,
          campanha_id: k.id,
          janela_inicio: janela.inicio,
          janela_fim: janela.fim,
          encerrada,
          numeros,
          respostas,
          sugestoes,
          leitura,
          custo_usd: Math.round((Number(linha?.custo_usd ?? 0) + custo) * 100_000) / 100_000,
          atualizado_em: agora.toISOString(),
        },
        { onConflict: "empresa_id,campanha_id" },
      );
      if (error) throw new Error(error.message);
      saida.acompanhadas += 1;
      if (!linha) saida.novas += 1;
      saida.custoUsd = Math.round((saida.custoUsd + custo) * 100_000) / 100_000;
    } catch (e) {
      saida.erros.push(`${k.nome}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return saida;
}

/**
 * Chamada pela varredura: uma vez por dia por empresa (22h–22h30 em São Paulo), para as empresas
 * com a Tatiana ligada. Pula a empresa que já foi atualizada hoje.
 */
export async function rodarAcompanhamentoCampanhas(
  db: Db,
  empresas: string[],
  agora: Date,
  hojeSP: string,
  horaSP: string,
): Promise<Record<string, unknown>> {
  if (horaSP < "22:00" || horaSP >= "22:30") return {};
  const inicioDoDia = new Date(`${hojeSP}T00:00:00-03:00`).toISOString();
  const saida: Record<string, unknown> = {};
  for (const emp of empresas) {
    const { data: ja } = await db
      .from("comercial_campanhas")
      .select("id")
      .eq("empresa_id", emp)
      .gte("atualizado_em", inicioDoDia)
      .limit(1);
    if (ja?.length) continue;
    saida[`campanhas_${emp.slice(0, 8)}`] = await acompanharCampanhas(db, emp, agora).catch(
      (e) => ({ erro: e instanceof Error ? e.message : String(e) }),
    );
  }
  return saida;
}
