/** "O que a Alice não soube" (05/11): casos da semana, lidos no Opus, recado só para o admin. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ESQUEMA_NAO_SOUBE,
  TIPO_NAO_SOUBE,
  aliceAdmitiuNaoSaber,
  instrucoesNaoSoube,
  passagemDeRegra,
  type CasoNaoSoube,
  type DadosNaoSoube,
} from "./alice-nao-soube";
import { MODELO_OPUS, PRECO_OPUS, custoUsd } from "./ficha";

type Db = SupabaseClient;

const PASSAGEM = "🤖 Alice passou a conversa para a equipe";
const curto = (t: string | null | undefined, n: number) =>
  (t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const diaSP = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });

type Msg = {
  conversa_id: string | null;
  direction: string;
  remetente_tipo: string | null;
  privada: boolean | null;
  text_content: string | null;
  transcricao: string | null;
  message_type: string | null;
  message_timestamp: string;
};

/** Leitura paginada (o PostgREST corta em 1000 linhas). */
async function todas<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null }>,
  maximo = 20_000,
): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; de < maximo; de += 1000) {
    const { data } = await consulta(de, de + 999);
    saida.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return saida;
}

const COLUNAS =
  "conversa_id, direction, remetente_tipo, privada, text_content, transcricao, message_type, message_timestamp";

/** Casos da semana: passagens por falta de conhecimento e respostas em que a Alice admitiu não saber. */
export async function casosDaSemana(
  db: Db,
  empresaId: string,
  agora: Date,
): Promise<CasoNaoSoube[]> {
  const desde = new Date(agora.getTime() - 7 * 86_400_000).toISOString();
  // 1. Só as mensagens da Alice (nota de passagem e respostas ao cliente) para achar os casos.
  const daAlice = await todas<Msg>((de, ate) =>
    db
      .from("whatsapp_messages")
      .select(COLUNAS)
      .eq("empresa_id", empresaId)
      .eq("remetente_tipo", "agent_bot")
      .gte("message_timestamp", desde)
      .not("conversa_id", "is", null)
      .order("message_timestamp")
      .range(de, ate),
  );
  const marcos: Array<{ conversa: string; em: string; motivo: string }> = [];
  const ultimoDaConversa = new Map<string, number>();
  for (const m of daAlice) {
    const conversa = m.conversa_id as string;
    const t = m.text_content ?? "";
    const em = Date.parse(m.message_timestamp);
    if (em - (ultimoDaConversa.get(conversa) ?? 0) <= 10 * 60_000) continue;
    let motivo: string | null = null;
    if (t.startsWith(PASSAGEM)) {
      const m2 = curto(t.split("Motivo: ")[1]?.split("\n")[0], 120);
      if (!passagemDeRegra(m2)) motivo = m2;
    } else if (!m.privada && !t.startsWith("🤖") && aliceAdmitiuNaoSaber(t)) {
      motivo = "a Alice disse que a equipe confirma";
    }
    if (motivo === null) continue;
    marcos.push({ conversa, em: m.message_timestamp, motivo });
    ultimoDaConversa.set(conversa, em);
  }
  if (!marcos.length) return [];
  marcos.splice(0, Math.max(0, marcos.length - 60));
  // 2. As conversas desses casos, inteiras na semana, para pegar a pergunta e a resposta da equipe.
  const ids = [...new Set(marcos.map((x) => x.conversa))];
  const porConversa = new Map<string, Msg[]>();
  for (let i = 0; i < ids.length; i += 50) {
    const parte = ids.slice(i, i + 50);
    const msgs = await todas<Msg>((de, ate) =>
      db
        .from("whatsapp_messages")
        .select(COLUNAS)
        .eq("empresa_id", empresaId)
        .in("conversa_id", parte)
        .gte("message_timestamp", desde)
        .order("message_timestamp")
        .range(de, ate),
    );
    for (const m of msgs) {
      const c = m.conversa_id as string;
      porConversa.set(c, [...(porConversa.get(c) ?? []), m]);
    }
  }
  const { data: convs } = await db
    .from("conversas")
    .select("id, whatsapp_contact_id")
    .in("id", [...new Set(marcos.map((x) => x.conversa))]);
  const contatos = ((convs ?? []) as Array<{ id: string; whatsapp_contact_id: string | null }>)
    .map((c) => c.whatsapp_contact_id)
    .filter(Boolean) as string[];
  const { data: tels } = contatos.length
    ? await db.from("whatsapp_contacts").select("id, normalized_phone").in("id", contatos)
    : { data: [] };
  const telDoContato = new Map(
    ((tels ?? []) as Array<{ id: string; normalized_phone: string | null }>).map((t) => [
      t.id,
      (t.normalized_phone ?? "").slice(-4),
    ]),
  );
  const fimDaConversa = new Map(
    ((convs ?? []) as Array<{ id: string; whatsapp_contact_id: string | null }>).map((c) => [
      c.id,
      c.whatsapp_contact_id ? (telDoContato.get(c.whatsapp_contact_id) ?? "") : "",
    ]),
  );

  return marcos.map((x) => {
    const msgs = porConversa.get(x.conversa) ?? [];
    const t = Date.parse(x.em);
    const texto = (m: Msg) => m.text_content || m.transcricao || `[${m.message_type ?? "mídia"}]`;
    const pergunta = msgs
      .filter((m) => m.direction === "Recebida" && Date.parse(m.message_timestamp) <= t)
      .slice(-2)
      .map(texto)
      .join(" / ");
    const alice = [...msgs]
      .filter(
        (m) =>
          m.remetente_tipo === "agent_bot" &&
          !m.privada &&
          !(m.text_content ?? "").startsWith("🤖") &&
          Date.parse(m.message_timestamp) <= t + 60_000,
      )
      .at(-1);
    const equipe = msgs
      .filter(
        (m) =>
          m.remetente_tipo === "user" &&
          !m.privada &&
          Date.parse(m.message_timestamp) > t &&
          !/seja muito bem-vind/i.test(m.text_content ?? ""),
      )
      .slice(0, 4)
      .map(texto)
      .join(" / ");
    return {
      fim: fimDaConversa.get(x.conversa) ?? "",
      dia: diaSP(x.em),
      pergunta: curto(pergunta, 300),
      alice: curto(`${x.motivo ? `(${x.motivo}) ` : ""}${alice ? texto(alice) : ""}`, 300),
      equipe: curto(equipe, 500),
    };
  });
}

/** Roteiro atual da Alice (módulos e perguntas frequentes), para o antes/depois. */
async function roteiroAtual(db: Db, empresaId: string): Promise<string> {
  const { data } = await db
    .from("ia_configuracoes")
    .select("modulos, perguntas_frequentes")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const c = data as {
    modulos: Array<{ chave: string; texto: string }> | null;
    perguntas_frequentes: string | null;
  } | null;
  const mods = (c?.modulos ?? []).map((m) => `### módulo ${m.chave}\n${m.texto}`).join("\n\n");
  return `${mods}\n\n### perguntas frequentes\n${c?.perguntas_frequentes || "(vazio)"}`;
}

export async function analisarNaoSoube(
  db: Db,
  empresaId: string,
  agora: Date,
  dia: string,
): Promise<{ id: string; custo: number; total: number }> {
  const casos = await casosDaSemana(db, empresaId, agora);
  const periodo = `Alice não soube · ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  if (!casos.length) {
    // Semana sem caso: grava o recado vazio (não repete a busca a cada passada).
    const vazio: DadosNaoSoube = {
      tipo: TIPO_NAO_SOUBE,
      dia,
      resumo: "Nenhum caso nesta semana.",
      total: 0,
      grupos: [],
    };
    const { data: rel, error } = await db
      .from("comercial_relatorios")
      .insert({ empresa_id: empresaId, periodo, dados: vazio, custo_usd: 0 })
      .select("id")
      .single();
    if (error) throw new Error(`não soube: ${error.message}`);
    return { id: (rel as { id: string }).id, custo: 0, total: 0 };
  }
  const [roteiro, { data: emp }] = await Promise.all([
    roteiroAtual(db, empresaId),
    db.from("empresas").select("nome").eq("id", empresaId).maybeSingle(),
  ]);
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { chamarIa } = await import("@/lib/alice/parada-ia.server");
  const resp = await chamarIa(
    () =>
      new Anthropic({ timeout: 280_000, maxRetries: 1 }).messages.create({
        model: MODELO_OPUS,
        max_tokens: 12_000,
        output_config: {
          effort: "medium",
          format: {
            type: "json_schema",
            schema: ESQUEMA_NAO_SOUBE as unknown as Record<string, unknown>,
          },
        },
        system: instrucoesNaoSoube((emp as { nome?: string } | null)?.nome ?? "empresa"),
        messages: [
          {
            role: "user",
            content: [
              "ROTEIRO ATUAL DA ALICE:",
              roteiro.slice(0, 40_000),
              "",
              `CASOS DA SEMANA (${casos.length}):`,
              ...casos.map(
                (c, i) =>
                  `${i + 1}. final ${c.fim} (${c.dia})\n   Cliente: ${c.pergunta || "-"}\n   Alice: ${c.alice || "-"}\n   Equipe depois: ${c.equipe || "(não respondeu)"}`,
              ),
            ].join("\n"),
          },
        ],
      }),
    { empresaId, origem: "alice_nao_soube" },
  );
  if (resp.stop_reason !== "end_turn") throw new Error(`não soube: ${resp.stop_reason}`);
  const r = JSON.parse(resp.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as {
    resumo?: string;
    grupos?: Array<{
      assunto: string;
      casos: number[];
      onde: string;
      antes: string;
      depois: string;
      pergunta_ao_dono: string;
    }>;
  };
  const grupos = (r.grupos ?? [])
    .map((g) => ({
      assunto: curto(g.assunto, 120),
      casos: [...new Set(g.casos ?? [])]
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= casos.length)
        .map((n) => casos[n - 1] as CasoNaoSoube),
      onde: curto(g.onde, 80),
      antes: String(g.antes ?? "")
        .trim()
        .slice(0, 2000),
      depois: String(g.depois ?? "")
        .trim()
        .slice(0, 2000),
      pergunta_ao_dono: curto(g.pergunta_ao_dono, 400),
    }))
    .filter((g) => g.assunto && g.casos.length);
  const total = grupos.reduce((s, g) => s + g.casos.length, 0);
  const custo = custoUsd(resp.usage, PRECO_OPUS);
  const dados: DadosNaoSoube = {
    tipo: TIPO_NAO_SOUBE,
    dia,
    resumo: curto(r.resumo, 500),
    total,
    grupos,
  };
  const { data: rel, error } = await db
    .from("comercial_relatorios")
    .insert({
      empresa_id: empresaId,
      periodo,
      dados,
      modelo: MODELO_OPUS,
      tokens_entrada: resp.usage.input_tokens,
      tokens_saida: resp.usage.output_tokens,
      custo_usd: custo,
    })
    .select("id")
    .single();
  if (error) throw new Error(`não soube: ${error.message}`);
  return { id: (rel as { id: string }).id, custo, total };
}

/** Domingo, na janela da revisão: uma empresa com a Alice ligada por passada, uma vez por semana. */
export async function rodarNaoSoube(
  db: Db,
  empresas: string[],
  agora: Date,
  hojeSP: string,
): Promise<Record<string, unknown>> {
  const saida: Record<string, unknown> = {};
  const { data: ias } = empresas.length
    ? await db
        .from("ia_configuracoes")
        .select("empresa_id")
        .in("empresa_id", empresas)
        .eq("ativo", true)
    : { data: [] };
  for (const { empresa_id: emp } of (ias ?? []) as Array<{ empresa_id: string }>) {
    const { count } = await db
      .from("comercial_relatorios")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", emp)
      .eq("dados->>tipo", TIPO_NAO_SOUBE)
      .eq("dados->>dia", hojeSP);
    if ((count ?? 0) > 0) continue;
    saida[`nao_soube_${emp.slice(0, 8)}`] = await analisarNaoSoube(db, emp, agora, hojeSP).catch(
      (e) => ({ erro: e instanceof Error ? e.message : String(e) }),
    );
    break;
  }
  return saida;
}
