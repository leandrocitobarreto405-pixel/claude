/**
 * Processador da Alice: pega uma tarefa da fila, conversa com a IA (Claude) usando o contexto da
 * empresa e do lead, responde no Chatwoot como o robô e registra custo e ferramentas usadas.
 *
 * Segurança: roda com a chave de serviço; toda consulta filtra pela empresa da tarefa.
 * Em qualquer falha a conversa vai para atendimento humano (o cliente nunca fica sem resposta).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { enviarMensagem, mudarSituacao, type Conta } from "./chatwoot-api.server";
import { executarFerramenta, FERRAMENTAS, type ContextoFerramenta } from "./ferramentas.server";
import {
  custoEstimadoUsd,
  dividirResposta,
  instrucoesDoMomento,
  instrucoesFixas,
  montarTurnos,
  type ContextoEmpresa,
  type ContextoLead,
  type MensagemHistorico,
  type Uso,
} from "./prompt";

type Admin = SupabaseClient<Database>;
type Tarefa = Database["public"]["Tables"]["ia_tarefas"]["Row"];

const MAX_RODADAS = 6;
const MAX_HISTORICO = 40;
const MAX_IMAGENS = 4;
const MAX_BYTES_IMAGEM = 4_500_000;
const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

export type ResultadoTarefa = { situacao: string; detalhe?: string };

async function admin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Admin;
}

export async function processarTarefa(tarefaId: string): Promise<ResultadoTarefa> {
  const db = await admin();
  const { data: reservada, error } = await db.rpc("ia_reservar_tarefa", { _tarefa_id: tarefaId });
  const tarefa = (reservada as Tarefa | null) ?? null;
  if (error) throw error;
  if (!tarefa?.id)
    return { situacao: "ignorada", detalhe: "tarefa não está pronta ou já foi feita" };

  try {
    const r =
      tarefa.tipo === "passar_para_humano"
        ? await passarParaHumano(db, tarefa)
        : await responder(db, tarefa);
    await concluir(db, tarefa.id, r.situacao === "erro" ? "erro" : r.situacao, r.detalhe);
    return r;
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error("Alice: erro na tarefa", tarefa.id, mensagem);
    await concluir(db, tarefa.id, "erro", mensagem);
    await socorroHumano(
      db,
      tarefa,
      "A Alice teve um problema técnico e não conseguiu responder.",
    ).catch((e2) => console.error("Alice: falha ao passar para humano após erro", e2));
    return { situacao: "erro", detalhe: mensagem };
  }
}

async function concluir(db: Admin, id: string, situacao: string, detalhe?: string) {
  await db
    .from("ia_tarefas")
    .update({
      situacao: situacao === "concluida" || situacao === "erro" ? situacao : "ignorada",
      concluida_em: new Date().toISOString(),
      ...(situacao === "erro" ? { erro: detalhe ?? null } : { motivo: detalhe ?? null }),
    })
    .eq("id", id);
}

// ---------------------------------------------------------------- dados comuns
type DadosConversa = {
  conversa: {
    id: string;
    chatwoot_conversation_id: number;
    status: string | null;
    crm_lead_id: string | null;
  };
  conta: Conta;
  tokenRobo: string | null;
  tokenAdmin: string | null;
};

async function dadosConversa(db: Admin, tarefa: Tarefa): Promise<DadosConversa> {
  const { data: conversa } = await db
    .from("conversas")
    .select("id, chatwoot_conversation_id, status, crm_lead_id, conexao_id")
    .eq("id", tarefa.conversa_id)
    .eq("empresa_id", tarefa.empresa_id)
    .single();
  if (!conversa) throw new Error("conversa não encontrada");
  const [{ data: conexao }, { data: segredos }] = await Promise.all([
    db
      .from("chatwoot_conexoes")
      .select("base_url, account_id")
      .eq("id", conversa.conexao_id)
      .single(),
    db
      .from("chatwoot_conexao_segredos")
      .select("alice_bot_token, api_token")
      .eq("conexao_id", conversa.conexao_id)
      .maybeSingle(),
  ]);
  if (!conexao) throw new Error("conexão do Chatwoot não encontrada");
  return {
    conversa,
    conta: { baseUrl: conexao.base_url, accountId: Number(conexao.account_id) },
    tokenRobo: segredos?.alice_bot_token ?? null,
    tokenAdmin: segredos?.api_token ?? null,
  };
}

async function passarParaHumano(db: Admin, tarefa: Tarefa): Promise<ResultadoTarefa> {
  const d = await dadosConversa(db, tarefa);
  const token = d.tokenRobo ?? d.tokenAdmin;
  if (!token) return { situacao: "ignorada", detalhe: "sem token do Chatwoot" };
  await mudarSituacao(d.conta, token, d.conversa.chatwoot_conversation_id, "open");
  await db.from("conversas").update({ status: "open" }).eq("id", d.conversa.id);
  return { situacao: "concluida", detalhe: tarefa.motivo ?? "passada para atendimento humano" };
}

/** Em erro: nota privada explicando e conversa para humano. */
async function socorroHumano(db: Admin, tarefa: Tarefa, nota: string) {
  const d = await dadosConversa(db, tarefa);
  const token = d.tokenRobo ?? d.tokenAdmin;
  if (!token) return;
  await enviarMensagem(d.conta, token, d.conversa.chatwoot_conversation_id, `🤖 ${nota}`, true);
  await mudarSituacao(d.conta, token, d.conversa.chatwoot_conversation_id, "open");
  await db.from("conversas").update({ status: "open" }).eq("id", d.conversa.id);
}

// ---------------------------------------------------------------- contexto
async function contextoEmpresa(
  db: Admin,
  empresaId: string,
  cfg: Database["public"]["Tables"]["ia_configuracoes"]["Row"],
): Promise<ContextoEmpresa> {
  const [empresa, config, precos, taxas, servicos] = await Promise.all([
    db.from("empresas").select("nome, telefone").eq("id", empresaId).single(),
    db
      .from("app_settings")
      .select("value")
      .eq("empresa_id", empresaId)
      .eq("key", "company")
      .maybeSingle(),
    db
      .from("tabela_precos_itens")
      .select("nome, preco_higienizacao, preco_impermeabilizacao")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .order("ordem"),
    db
      .from("payment_rates")
      .select("payment_type, installments")
      .eq("empresa_id", empresaId)
      .eq("active", true),
    db
      .from("config_options")
      .select("name")
      .eq("empresa_id", empresaId)
      .eq("kind", "service_type")
      .eq("active", true)
      .order("display_order"),
  ]);
  const v = (config.data?.value ?? {}) as { name?: string; phone?: string; instagram?: string };
  const parcelas = new Map<string, number>();
  for (const t of taxas.data ?? []) {
    const tipo = t.payment_type?.trim();
    if (!tipo) continue;
    parcelas.set(tipo, Math.max(parcelas.get(tipo) ?? 1, Number(t.installments ?? 1)));
  }
  return {
    empresa: v.name || empresa.data?.nome || "a empresa",
    telefone: v.phone || empresa.data?.telefone || null,
    instagram: v.instagram || null,
    nomeAssistente: cfg.nome,
    instrucoes: cfg.instrucoes,
    perguntasFrequentes: cfg.perguntas_frequentes,
    descontoMaxPercentual: Number(cfg.desconto_max_percentual),
    precos: (precos.data ?? []).map((p) => ({
      nome: p.nome,
      higienizacao: p.preco_higienizacao !== null ? Number(p.preco_higienizacao) : null,
      impermeabilizacao:
        p.preco_impermeabilizacao !== null ? Number(p.preco_impermeabilizacao) : null,
    })),
    formasPagamento: [...parcelas.entries()].map(([tipo, n]) =>
      n > 1 ? `${tipo} em até ${n}x` : tipo,
    ),
    servicos: (servicos.data ?? []).map((s) => s.name),
  };
}

async function contextoLead(db: Admin, empresaId: string, leadId: string | null) {
  if (!leadId) return { lead: null as ContextoLead | null, salesperson: null as string | null };
  const { data } = await db
    .from("crm_leads")
    .select(
      "lead_name, phone, service_interest, upholstery_description, summary, customer_id, salesperson_id, origem:sales_origin_id ( name ), campanha:campaign_id ( campaign_name )",
    )
    .eq("id", leadId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!data) return { lead: null, salesperson: null };
  const l = data as unknown as {
    lead_name: string | null;
    phone: string | null;
    service_interest: string | null;
    upholstery_description: string | null;
    summary: string | null;
    customer_id: string | null;
    salesperson_id: string | null;
    origem: { name: string } | null;
    campanha: { campaign_name: string } | null;
  };
  return {
    lead: {
      nome: l.lead_name,
      telefone: l.phone,
      origem: l.origem?.name ?? null,
      campanha: l.campanha?.campaign_name ?? null,
      servicoInteresse: l.service_interest,
      descricaoEstofados: l.upholstery_description,
      resumo: l.summary,
      clienteExistente: Boolean(l.customer_id),
    } satisfies ContextoLead,
    salesperson: l.salesperson_id,
  };
}

async function baixarImagem(url: string): Promise<MensagemHistorico["imagens"][number] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const tipo = (res.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim() as (typeof TIPOS_IMAGEM)[number];
    if (!TIPOS_IMAGEM.includes(tipo)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES_IMAGEM) return null;
    return { mediaType: tipo, base64: Buffer.from(bytes).toString("base64") };
  } catch {
    return null;
  }
}

async function historico(
  db: Admin,
  empresaId: string,
  conversaId: string,
): Promise<MensagemHistorico[]> {
  const { data } = await db
    .from("whatsapp_messages")
    .select(
      "direction, text_content, message_type, remetente_tipo, raw_event_reference, message_timestamp",
    )
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .eq("privada", false)
    .order("message_timestamp", { ascending: false })
    .limit(MAX_HISTORICO);
  const linhas = (data ?? []).reverse();

  // Fotos: só as mais recentes, lidas do evento original (URL do anexo no Chatwoot).
  const comFoto = linhas
    .filter(
      (m) => m.direction === "Recebida" && m.message_type === "Imagem" && m.raw_event_reference,
    )
    .slice(-MAX_IMAGENS);
  const fotos = new Map<string, MensagemHistorico["imagens"]>();
  if (comFoto.length) {
    const { data: eventos } = await db
      .from("integracao_eventos")
      .select("id, payload")
      .eq("empresa_id", empresaId)
      .in(
        "id",
        comFoto.map((m) => m.raw_event_reference as string),
      );
    for (const ev of eventos ?? []) {
      const anexos = (
        (ev.payload as { attachments?: Array<{ file_type?: string; data_url?: string }> })
          ?.attachments ?? []
      ).filter((a) => a.file_type === "image" && a.data_url);
      const imgs = (
        await Promise.all(anexos.slice(0, 2).map((a) => baixarImagem(a.data_url!)))
      ).filter((x): x is NonNullable<typeof x> => x !== null);
      fotos.set(ev.id, imgs);
    }
  }

  return linhas.map((m) => ({
    direcao: m.direction === "Recebida" ? "Recebida" : "Enviada",
    texto: m.text_content,
    tipo: m.message_type,
    remetente: m.remetente_tipo,
    imagens: (m.raw_event_reference && fotos.get(m.raw_event_reference)) || [],
  }));
}

// ---------------------------------------------------------------- resposta
async function responder(db: Admin, tarefa: Tarefa): Promise<ResultadoTarefa> {
  const inicio = Date.now();
  const { data: cfg } = await db
    .from("ia_configuracoes")
    .select("*")
    .eq("empresa_id", tarefa.empresa_id)
    .maybeSingle();
  if (!cfg?.ativo) return { situacao: "ignorada", detalhe: "Alice desligada" };

  const d = await dadosConversa(db, tarefa);
  if (d.conversa.status !== "pending")
    return { situacao: "ignorada", detalhe: "conversa com atendente humano" };
  if (!d.tokenRobo) throw new Error("robô da Alice não configurado no Chatwoot");

  const { count } = await db
    .from("ia_execucoes")
    .select("id", { count: "exact", head: true })
    .eq("conversa_id", d.conversa.id)
    .is("erro", null);
  if ((count ?? 0) >= cfg.limite_respostas_conversa) {
    await socorroHumano(db, tarefa, "A Alice atingiu o limite de respostas nesta conversa.");
    return { situacao: "concluida", detalhe: "limite de respostas: passada para humano" };
  }

  const [empresa, { lead, salesperson }, msgs] = await Promise.all([
    contextoEmpresa(db, tarefa.empresa_id, cfg),
    contextoLead(db, tarefa.empresa_id, d.conversa.crm_lead_id),
    historico(db, tarefa.empresa_id, d.conversa.id),
  ]);
  const turnos = montarTurnos(msgs);
  if (!turnos) return { situacao: "ignorada", detalhe: "nada novo do cliente para responder" };

  const ctxFerramenta: ContextoFerramenta = {
    admin: db,
    empresaId: tarefa.empresa_id,
    leadId: d.conversa.crm_lead_id,
    passagem: null,
  };
  const cliente = new Anthropic();
  const sistema: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: instrucoesFixas(empresa), cache_control: { type: "ephemeral" } },
    { type: "text", text: instrucoesDoMomento(new Date(), lead) },
  ];
  const uso: Uso = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
  const ferramentasUsadas: Array<{ nome: string; entrada: unknown; resultado: string }> = [];
  const textos: string[] = [];
  let parada: string | null = null;
  let modeloUsado = cfg.modelo;
  let rodadas = 0;
  const mensagens = [...turnos];

  while (rodadas < MAX_RODADAS) {
    rodadas++;
    const resposta = await cliente.beta.messages.create({
      model: cfg.modelo,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: cfg.esforco as "low" | "medium" | "high" },
      ...(cfg.modelo === "claude-opus-5"
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      system: sistema,
      tools: FERRAMENTAS,
      messages: mensagens,
    });
    modeloUsado = resposta.model;
    uso.entrada += resposta.usage.input_tokens;
    uso.saida += resposta.usage.output_tokens;
    uso.cacheLeitura += resposta.usage.cache_read_input_tokens ?? 0;
    uso.cacheEscrita += resposta.usage.cache_creation_input_tokens ?? 0;
    parada = resposta.stop_reason;

    if (resposta.stop_reason === "refusal") break;
    // Vale o texto da última rodada que escreveu algo (evita repetir o que veio antes de uma ferramenta).
    const daRodada = resposta.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text" && b.text.trim() !== "")
      .map((b) => b.text.trim());
    if (daRodada.length) textos.splice(0, textos.length, ...daRodada);

    const chamadas = resposta.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (resposta.stop_reason !== "tool_use" || !chamadas.length) break;

    mensagens.push({ role: "assistant", content: resposta.content });
    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const c of chamadas) {
      const r = await executarFerramenta(ctxFerramenta, c.name, c.input);
      ferramentasUsadas.push({
        nome: c.name,
        entrada: c.input,
        resultado: r.conteudo.slice(0, 500),
      });
      resultados.push({
        type: "tool_result",
        tool_use_id: c.id,
        content: r.conteudo,
        is_error: r.erro,
      });
    }
    mensagens.push({ role: "user", content: resultados });
  }

  const registro = {
    empresa_id: tarefa.empresa_id,
    conversa_id: d.conversa.id,
    tarefa_id: tarefa.id,
    crm_lead_id: d.conversa.crm_lead_id,
    modelo: modeloUsado,
    rodadas,
    tokens_entrada: uso.entrada,
    tokens_saida: uso.saida,
    tokens_cache_leitura: uso.cacheLeitura,
    tokens_cache_escrita: uso.cacheEscrita,
    custo_usd: custoEstimadoUsd(modeloUsado, uso),
    duracao_ms: Date.now() - inicio,
    ferramentas: ferramentasUsadas as never,
    parada,
  };

  if (parada === "refusal" || (!textos.length && !ctxFerramenta.passagem)) {
    await db.from("ia_execucoes").insert({ ...registro, erro: "sem resposta da IA" });
    await socorroHumano(
      db,
      tarefa,
      "A Alice não soube responder esta mensagem. Por favor, assuma a conversa.",
    );
    return { situacao: "concluida", detalhe: "sem resposta: passada para humano" };
  }

  // Mensagem nova do cliente chegou enquanto a Alice pensava: a próxima tarefa responde tudo junto.
  const [{ data: novaTarefa }, { data: agora }] = await Promise.all([
    db
      .from("ia_tarefas")
      .select("id")
      .eq("conversa_id", d.conversa.id)
      .eq("tipo", "responder")
      .eq("situacao", "pendente")
      .maybeSingle(),
    db.from("conversas").select("status").eq("id", d.conversa.id).single(),
  ]);
  if (novaTarefa) {
    await db
      .from("ia_execucoes")
      .insert({ ...registro, erro: "descartada: cliente mandou mensagem nova" });
    return {
      situacao: "ignorada",
      detalhe: "cliente mandou mensagem nova; resposta refeita na próxima tarefa",
    };
  }
  if (agora?.status !== "pending") {
    await db.from("ia_execucoes").insert({ ...registro, erro: "descartada: humano assumiu" });
    return { situacao: "ignorada", detalhe: "humano assumiu durante o processamento" };
  }

  const partes = dividirResposta(textos.join("\n\n"));
  for (const parte of partes) {
    await enviarMensagem(d.conta, d.tokenRobo, d.conversa.chatwoot_conversation_id, parte);
  }
  await db.from("ia_execucoes").insert({ ...registro, mensagens_enviadas: partes });

  // A Alice passa a constar como vendedora do lead (quem fechar pode trocar na OS).
  if (d.conversa.crm_lead_id && !salesperson) {
    const { data: alice } = await db
      .from("salespeople")
      .select("id")
      .eq("empresa_id", tarefa.empresa_id)
      .eq("eh_ia", true)
      .maybeSingle();
    if (alice) {
      await db
        .from("crm_leads")
        .update({ salesperson_id: alice.id })
        .eq("id", d.conversa.crm_lead_id)
        .eq("empresa_id", tarefa.empresa_id)
        .is("salesperson_id", null);
    }
  }

  if (ctxFerramenta.passagem) {
    const { motivo, resumo } = ctxFerramenta.passagem;
    await enviarMensagem(
      d.conta,
      d.tokenRobo,
      d.conversa.chatwoot_conversation_id,
      `🤖 ${cfg.nome} passou a conversa para a equipe.\nMotivo: ${motivo}\nResumo: ${resumo}`,
      true,
    );
    await mudarSituacao(d.conta, d.tokenRobo, d.conversa.chatwoot_conversation_id, "open");
    await db.from("conversas").update({ status: "open" }).eq("id", d.conversa.id);
    return { situacao: "concluida", detalhe: `respondeu e passou para humano: ${motivo}` };
  }
  return { situacao: "concluida", detalhe: `${partes.length} mensagem(ns) enviada(s)` };
}
