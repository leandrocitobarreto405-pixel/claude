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
import { enviarAnexo, enviarMensagem, mudarSituacao, type Conta } from "./chatwoot-api.server";
import {
  cancelarFollowupPendente,
  executarFerramenta,
  ferramentasDisponiveis,
  type ConfigIa,
  type ContextoFerramenta,
  type Saida,
} from "./ferramentas.server";
import {
  custoEstimadoUsd,
  dividirResposta,
  limparTexto,
  instrucoesDoMomento,
  instrucoesFixas,
  montarTurnos,
  type ContextoEmpresa,
  type ContextoLead,
  type MensagemHistorico,
  type Uso,
} from "./prompt";
import { chaveTelefone } from "@/lib/avisos";
import { dentroDaJanela, dentroDoHorario, proximoHorarioPermitido, textoInterno } from "./regras";

type Admin = SupabaseClient<Database>;
type Tarefa = Database["public"]["Tables"]["ia_tarefas"]["Row"];

const MAX_RODADAS = 8;
const MAX_HISTORICO = 40;
const MAX_IMAGENS = 4;
const MAX_AUDIOS_TRANSCRITOS = 3;
const MAX_MENSAGENS_POR_RESPOSTA = 10;
const MAX_BYTES_IMAGEM = 4_500_000;
const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
/** Modelos que aceitam o fallback automático do servidor quando recusam ("default"). */
const COM_FALLBACK = ["claude-opus-5", "claude-opus-5-5", "claude-sonnet-5-5"];
/** Modelos sem mensagem de sistema no meio da conversa: o momento vai no bloco de sistema. */
const SEM_SISTEMA_NO_MEIO = ["claude-sonnet-5"];
/** Resposta do modelo quando o follow-up não deve ser enviado. */
const NADA = "NADA";

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
        : tarefa.tipo === "devolver_para_alice"
          ? await devolverParaAlice(db, tarefa)
          : tarefa.tipo === "enviar_mensagens"
            ? await enviarProgramadas(db, tarefa)
            : tarefa.tipo === "followup"
              ? await fazerFollowup(db, tarefa)
              : await responder(db, tarefa);
    if (r.situacao !== "adiada") {
      await concluir(db, tarefa.id, r.situacao === "erro" ? "erro" : r.situacao, r.detalhe);
    }
    return r;
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error("Alice: erro na tarefa", tarefa.id, mensagem);
    await concluir(db, tarefa.id, "erro", mensagem);
    if (tarefa.tipo === "followup") {
      await followupParaEquipe(db, tarefa, "a Alice teve um erro técnico no follow-up").catch(
        () => undefined,
      );
    } else {
      await socorroHumano(
        db,
        tarefa,
        "A Alice teve um problema técnico e não conseguiu responder.",
      ).catch((e2) => console.error("Alice: falha ao passar para humano após erro", e2));
    }
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
    whatsapp_contact_id: string | null;
  };
  conta: Conta;
  tokenRobo: string | null;
  tokenAdmin: string | null;
  contato: { ia_desligada: boolean; sem_pos_venda: boolean; normalized_phone: string } | null;
};

async function dadosConversa(db: Admin, tarefa: Tarefa): Promise<DadosConversa> {
  const { data: conversa } = await db
    .from("conversas")
    .select("id, chatwoot_conversation_id, status, crm_lead_id, conexao_id, whatsapp_contact_id")
    .eq("id", tarefa.conversa_id)
    .eq("empresa_id", tarefa.empresa_id)
    .single();
  if (!conversa) throw new Error("conversa não encontrada");
  const [{ data: conexao }, { data: segredos }, { data: contato }] = await Promise.all([
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
    conversa.whatsapp_contact_id
      ? db
          .from("whatsapp_contacts")
          .select("ia_desligada, sem_pos_venda, normalized_phone")
          .eq("id", conversa.whatsapp_contact_id)
          .eq("empresa_id", tarefa.empresa_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!conexao) throw new Error("conexão do Chatwoot não encontrada");
  return {
    conversa,
    conta: { baseUrl: conexao.base_url, accountId: Number(conexao.account_id) },
    tokenRobo: segredos?.alice_bot_token ?? null,
    tokenAdmin: segredos?.api_token ?? null,
    contato: contato ?? null,
  };
}

async function passarParaHumano(db: Admin, tarefa: Tarefa): Promise<ResultadoTarefa> {
  const d = await dadosConversa(db, tarefa);
  const token = d.tokenRobo ?? d.tokenAdmin;
  if (!token) return { situacao: "ignorada", detalhe: "sem token do Chatwoot" };
  const nota = (tarefa.dados as { nota?: string } | null)?.nota;
  if (nota) await enviarMensagem(d.conta, token, d.conversa.chatwoot_conversation_id, nota, true);
  await mudarSituacao(d.conta, token, d.conversa.chatwoot_conversation_id, "open");
  await db.from("conversas").update({ status: "open" }).eq("id", d.conversa.id);
  return { situacao: "concluida", detalhe: tarefa.motivo ?? "passada para atendimento humano" };
}

/** A equipe devolveu a conversa (#alice): volta a ser do robô e, se o cliente está esperando, ela responde. */
async function devolverParaAlice(db: Admin, tarefa: Tarefa): Promise<ResultadoTarefa> {
  const [cfg, d] = await Promise.all([lerConfig(db, tarefa.empresa_id), dadosConversa(db, tarefa)]);
  const token = d.tokenAdmin ?? d.tokenRobo;
  if (!token) return { situacao: "ignorada", detalhe: "sem token do Chatwoot" };
  const conversa = d.conversa.chatwoot_conversation_id;
  if (!cfg?.ativo) {
    await enviarMensagem(
      d.conta,
      token,
      conversa,
      "🤖 A Alice está desligada na empresa (Configurações do Nexa OS): a conversa continua com a equipe.",
      true,
    );
    return { situacao: "ignorada", detalhe: "Alice desligada" };
  }
  await mudarSituacao(d.conta, token, conversa, "pending");
  await db.from("conversas").update({ status: "pending" }).eq("id", d.conversa.id);
  const { data: ultima } = await db
    .from("whatsapp_messages")
    .select("direction")
    .eq("conversa_id", d.conversa.id)
    .eq("privada", false)
    .order("message_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  const esperando = ultima?.direction === "Recebida";
  await enviarMensagem(
    d.conta,
    token,
    conversa,
    esperando
      ? `🤖 Ok! A ${cfg.nome} voltou para esta conversa e já vai responder o cliente.`
      : `🤖 Ok! A ${cfg.nome} voltou para esta conversa e responde a próxima mensagem do cliente.`,
    true,
  );
  if (esperando) {
    // Já existir uma resposta pendente (índice único) está ok: ela responde.
    const { error } = await db.from("ia_tarefas").insert({
      empresa_id: tarefa.empresa_id,
      conversa_id: d.conversa.id,
      tipo: "responder",
    });
    if (error && error.code !== "23505") throw error;
    const { enfileirarPendentes } = await import("./fila.server");
    await enfileirarPendentes(db);
  }
  return { situacao: "concluida", detalhe: "conversa devolvida para a Alice" };
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
async function etapasAbertas(db: Admin, empresaId: string): Promise<string[]> {
  const { data } = await db
    .from("config_options")
    .select("name, metadata")
    .eq("empresa_id", empresaId)
    .eq("kind", "crm_status")
    .eq("active", true)
    .order("display_order");
  return (data ?? [])
    .filter((o) => (o.metadata as { closed?: boolean } | null)?.closed !== true)
    .map((o) => o.name);
}

async function contextoEmpresa(
  db: Admin,
  empresaId: string,
  cfg: ConfigIa,
  ferramentas: string[],
): Promise<ContextoEmpresa> {
  const [empresa, config, precos, servicos, equipe] = await Promise.all([
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
      .from("config_options")
      .select("name")
      .eq("empresa_id", empresaId)
      .eq("kind", "service_type")
      .eq("active", true)
      .order("display_order"),
    db
      .from("salespeople")
      .select("name")
      .eq("empresa_id", empresaId)
      .eq("active", true)
      .eq("eh_ia", false)
      .order("name"),
  ]);
  const v = (config.data?.value ?? {}) as { name?: string; phone?: string; instagram?: string };
  const preco = (x: number | null) => (x === null || Number(x) <= 0 ? null : Number(x));
  return {
    // Nome oficial do cadastro da empresa (o de Configurações pode ter ficado com um padrão antigo).
    empresa: empresa.data?.nome || v.name || "a empresa",
    telefone: v.phone || empresa.data?.telefone || null,
    instagram: v.instagram || null,
    nomeAssistente: cfg.nome,
    descricaoNegocio: cfg.descricao_negocio ?? "",
    instrucoes: cfg.instrucoes,
    perguntasFrequentes: cfg.perguntas_frequentes,
    precos: (precos.data ?? []).map((p) => ({
      nome: p.nome,
      higienizacao: preco(p.preco_higienizacao),
      impermeabilizacao: preco(p.preco_impermeabilizacao),
    })),
    servicos: (servicos.data ?? []).map((s) => s.name),
    equipe: (equipe.data ?? []).map((s) => s.name.split(/\s+/)[0]!).filter(Boolean),
    descontoPixPercentual: Number(cfg.desconto_pix_percentual),
    parcelasMax: cfg.parcelas_max,
    validadeDias: cfg.validade_orcamento_dias,
    horaInicio: cfg.hora_inicio,
    horaFim: cfg.hora_fim,
    ferramentas,
  };
}

async function contextoLead(
  db: Admin,
  empresaId: string,
  leadId: string | null,
  semPosVenda: boolean,
) {
  if (!leadId) return { lead: null as ContextoLead | null, salesperson: null as string | null };
  const { data } = await db
    .from("crm_leads")
    .select(
      "lead_name, phone, service_interest, upholstery_description, summary, customer_id, salesperson_id, origem:sales_origin_id ( name ), campanha:campaign_id ( campaign_name ), status:status_id ( name )",
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
    status: { name: string } | null;
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
      etapa: l.status?.name ?? null,
      clienteExistente: Boolean(l.customer_id),
      semPosVenda,
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

type Anexos = Array<{ file_type?: string; data_url?: string }>;

async function historico(
  db: Admin,
  empresaId: string,
  conversaId: string,
  transcrever: boolean,
): Promise<{ mensagens: MensagemHistorico[]; ultimaDoCliente: Date | null }> {
  const { data } = await db
    .from("whatsapp_messages")
    .select(
      "id, direction, text_content, message_type, remetente_tipo, raw_event_reference, message_timestamp, transcricao",
    )
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .eq("privada", false)
    .order("message_timestamp", { ascending: false })
    .limit(MAX_HISTORICO);
  const linhas = (data ?? []).reverse();
  const recebidas = linhas.filter((m) => m.direction === "Recebida");
  const ultima = recebidas[recebidas.length - 1];

  // Fotos (as mais recentes) e áudios ainda sem transcrição: anexos lidos do evento original.
  const comFoto = recebidas
    .filter((m) => m.message_type === "Imagem" && m.raw_event_reference)
    .slice(-MAX_IMAGENS);
  const semTranscricao = transcrever
    ? recebidas
        .filter((m) => m.message_type === "Áudio" && m.raw_event_reference && !m.transcricao)
        .slice(-MAX_AUDIOS_TRANSCRITOS)
    : [];
  const eventos = new Map<string, Anexos>();
  const refs = comFoto.map((m) => m.raw_event_reference as string);
  if (refs.length) {
    const { data: evs } = await db
      .from("integracao_eventos")
      .select("id, payload")
      .eq("empresa_id", empresaId)
      .in("id", refs);
    for (const ev of evs ?? []) {
      eventos.set(ev.id, ((ev.payload as { attachments?: Anexos })?.attachments ?? []) as Anexos);
    }
  }

  const fotos = new Map<string, MensagemHistorico["imagens"]>();
  await Promise.all(
    comFoto.map(async (m) => {
      const anexos = (eventos.get(m.raw_event_reference as string) ?? []).filter(
        (a) => a.file_type === "image" && a.data_url,
      );
      const imgs = (
        await Promise.all(anexos.slice(0, 2).map((a) => baixarImagem(a.data_url!)))
      ).filter((x): x is NonNullable<typeof x> => x !== null);
      fotos.set(m.id, imgs);
    }),
  );

  if (semTranscricao.length) {
    const { transcreverMensagens } = await import("./audios.server");
    const textos = await transcreverMensagens(db, empresaId, semTranscricao);
    for (const m of semTranscricao) {
      const t = textos.get(m.id);
      if (t) m.transcricao = t;
    }
  }

  return {
    mensagens: linhas.map((m) => ({
      direcao: m.direction === "Recebida" ? "Recebida" : "Enviada",
      texto: m.text_content,
      tipo: m.message_type,
      remetente: m.remetente_tipo,
      transcricao: m.transcricao,
      imagens: fotos.get(m.id) ?? [],
    })),
    ultimaDoCliente: ultima ? new Date(ultima.message_timestamp) : null,
  };
}

// ---------------------------------------------------------------- tarefas
async function lerConfig(db: Admin, empresaId: string) {
  const [{ data }, { data: empresa }] = await Promise.all([
    db.from("ia_configuracoes").select("*").eq("empresa_id", empresaId).maybeSingle(),
    db.from("empresas").select("implantacao_liberada_em").eq("id", empresaId).maybeSingle(),
  ]);
  // Empresa ainda em implantação (não liberada pela Nexa): a Alice não atende.
  if (data && !empresa?.implantacao_liberada_em) return { ...data, ativo: false };
  return data;
}

async function responder(db: Admin, tarefa: Tarefa): Promise<ResultadoTarefa> {
  const cfg = await lerConfig(db, tarefa.empresa_id);
  if (!cfg?.ativo) return { situacao: "ignorada", detalhe: "Alice desligada" };
  const d = await dadosConversa(db, tarefa);
  if (d.contato?.ia_desligada)
    return { situacao: "ignorada", detalhe: "IA desligada para o cliente" };
  if (d.conversa.status !== "pending")
    return { situacao: "ignorada", detalhe: "conversa com atendente humano" };
  return conversar(db, tarefa, cfg, d, null);
}

type DadosFollowup = { trilha?: string; motivo?: string; mensagem_sugerida?: string };

/** A repescagem do follow-up vai para a equipe (com o motivo). */
async function followupParaEquipe(db: Admin, tarefa: Tarefa, motivo: string) {
  const { data: f } = await db
    .from("crm_followups")
    .select("id, notes")
    .eq("empresa_id", tarefa.empresa_id)
    .eq("ia_tarefa_id", tarefa.id)
    .eq("status", "Pendente")
    .maybeSingle();
  if (!f) return;
  await db
    .from("crm_followups")
    .update({
      responsavel: "equipe",
      notes: `${f.notes ?? ""}\nFicou para a equipe: ${motivo}.`.trim(),
    })
    .eq("id", f.id);
}

async function fazerFollowup(db: Admin, tarefa: Tarefa): Promise<ResultadoTarefa> {
  const cfg = await lerConfig(db, tarefa.empresa_id);
  if (!cfg?.ativo) {
    await followupParaEquipe(db, tarefa, "Alice desligada");
    return { situacao: "ignorada", detalhe: "Alice desligada" };
  }
  const d = await dadosConversa(db, tarefa);
  if (d.contato?.ia_desligada) {
    await cancelarFollowupPendente(
      db,
      tarefa.empresa_id,
      d.conversa.id,
      "IA desligada para o cliente",
    );
    return { situacao: "ignorada", detalhe: "IA desligada para o cliente" };
  }
  // Contato interno da equipe (marcado pelo admin) não recebe follow-up de cliente.
  const chave = chaveTelefone(d.contato?.normalized_phone);
  if (chave) {
    const { data: interno } = await db
      .from("contatos_internos")
      .select("id")
      .eq("empresa_id", tarefa.empresa_id)
      .eq("chave", chave)
      .limit(1);
    if (interno?.length) {
      await cancelarFollowupPendente(
        db,
        tarefa.empresa_id,
        d.conversa.id,
        "contato interno da equipe",
      );
      await db
        .from("crm_followups")
        .update({
          status: "Cancelada",
          completed_at: new Date().toISOString(),
          result: "contato interno da equipe",
        })
        .eq("empresa_id", tarefa.empresa_id)
        .eq("ia_tarefa_id", tarefa.id)
        .eq("status", "Pendente");
      return { situacao: "ignorada", detalhe: "contato interno da equipe" };
    }
  }
  if (d.conversa.status !== "pending") {
    await followupParaEquipe(db, tarefa, "conversa está com a equipe");
    return { situacao: "ignorada", detalhe: "conversa com atendente humano" };
  }

  const { data: ultima } = await db
    .from("whatsapp_messages")
    .select("message_timestamp")
    .eq("empresa_id", tarefa.empresa_id)
    .eq("conversa_id", d.conversa.id)
    .eq("direction", "Recebida")
    .eq("privada", false)
    .order("message_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ultimaDoCliente = ultima ? new Date(ultima.message_timestamp) : null;
  const agora = new Date();

  if (!dentroDoHorario(agora, cfg.hora_inicio, cfg.hora_fim)) {
    const depois = proximoHorarioPermitido(agora, cfg.hora_inicio, cfg.hora_fim);
    if (dentroDaJanela(ultimaDoCliente, depois)) {
      await db
        .from("ia_tarefas")
        .update({ situacao: "pendente", executar_apos: depois.toISOString(), enfileirada: false })
        .eq("id", tarefa.id);
      await db
        .from("crm_followups")
        .update({ scheduled_at: depois.toISOString() })
        .eq("empresa_id", tarefa.empresa_id)
        .eq("ia_tarefa_id", tarefa.id);
      const { enfileirarPendentes } = await import("./fila.server");
      await enfileirarPendentes(db);
      return {
        situacao: "adiada",
        detalhe: `fora do horário: adiado para ${depois.toISOString()}`,
      };
    }
    await followupParaEquipe(db, tarefa, "fora do horário e da janela de 24 h do WhatsApp");
    return { situacao: "ignorada", detalhe: "fora do horário e da janela de 24 h" };
  }
  if (!dentroDaJanela(ultimaDoCliente, agora)) {
    await followupParaEquipe(
      db,
      tarefa,
      "passou a janela de 24 h do WhatsApp (precisa de modelo aprovado)",
    );
    return { situacao: "ignorada", detalhe: "fora da janela de 24 h do WhatsApp" };
  }

  const dados = (tarefa.dados ?? {}) as DadosFollowup;
  const aviso = [
    `Hora do follow-up agendado (trilha ${dados.trilha ?? "?"}): ${dados.motivo ?? tarefa.motivo ?? "cliente sem responder"}.`,
    dados.mensagem_sugerida ? `Sugestão anotada: "${dados.mensagem_sugerida}".` : null,
    "O cliente não respondeu desde a última mensagem da empresa. Faça agora o toque de follow-up, seguindo as instruções (algo novo, uma pergunta só). Se as instruções mandarem fazer algo neste toque (ex.: mandar o orçamento), use as ferramentas normalmente.",
    `Se não fizer sentido mandar nada (por exemplo, o atendimento já foi encerrado), responda exatamente ${NADA}.`,
    "Se for o caso, agende o próximo toque com agendar_followup.",
  ]
    .filter(Boolean)
    .join(" ");
  return conversar(db, tarefa, cfg, d, aviso);
}

/** Conclui a repescagem ligada ao follow-up. */
async function concluirRepescagem(
  db: Admin,
  tarefa: Tarefa,
  resultado: string,
  cancelada: boolean,
) {
  const { data: f } = await db
    .from("crm_followups")
    .update({
      status: cancelada ? "Cancelada" : "Concluída",
      completed_at: new Date().toISOString(),
      result: resultado,
    })
    .eq("empresa_id", tarefa.empresa_id)
    .eq("ia_tarefa_id", tarefa.id)
    .eq("status", "Pendente")
    .select("crm_lead_id")
    .maybeSingle();
  if (!f) return;
  const { data: prox } = await db
    .from("crm_followups")
    .select("scheduled_at")
    .eq("empresa_id", tarefa.empresa_id)
    .eq("crm_lead_id", f.crm_lead_id)
    .eq("status", "Pendente")
    .order("scheduled_at")
    .limit(1)
    .maybeSingle();
  const agora = new Date().toISOString();
  await db
    .from("crm_leads")
    .update({
      next_follow_up_at: prox?.scheduled_at ?? null,
      ...(cancelada ? {} : { last_follow_up_at: agora, follow_up_result: resultado }),
    })
    .eq("id", f.crm_lead_id)
    .eq("empresa_id", tarefa.empresa_id);
}

// ---------------------------------------------------------------- conversa com a IA
async function conversar(
  db: Admin,
  tarefa: Tarefa,
  cfg: ConfigIa,
  d: DadosConversa,
  avisoFollowup: string | null,
): Promise<ResultadoTarefa> {
  const inicio = Date.now();
  if (!d.tokenRobo) throw new Error("robô da Alice não configurado no Chatwoot");
  const ehFollowup = avisoFollowup !== null;

  const { count } = await db
    .from("ia_execucoes")
    .select("id", { count: "exact", head: true })
    .eq("conversa_id", d.conversa.id)
    .is("erro", null);
  if ((count ?? 0) >= cfg.limite_respostas_conversa) {
    if (ehFollowup) {
      await followupParaEquipe(db, tarefa, "limite de respostas da Alice na conversa");
      return { situacao: "ignorada", detalhe: "limite de respostas" };
    }
    await socorroHumano(db, tarefa, "A Alice atingiu o limite de respostas nesta conversa.");
    return { situacao: "concluida", detalhe: "limite de respostas: passada para humano" };
  }

  // O que ficou programado (orçamento depois do vídeo) sai antes da resposta nova.
  if (await descarregarProgramadas(db, tarefa.empresa_id, d)) {
    await new Promise((r) => setTimeout(r, ESPERA_WEBHOOK_MS));
  }

  const etapas = await etapasAbertas(db, tarefa.empresa_id);
  const ferramentas = ferramentasDisponiveis(cfg, etapas);
  const [empresa, { lead, salesperson }, hist] = await Promise.all([
    contextoEmpresa(
      db,
      tarefa.empresa_id,
      cfg,
      ferramentas.map((f) => f.name),
    ),
    contextoLead(db, tarefa.empresa_id, d.conversa.crm_lead_id, Boolean(d.contato?.sem_pos_venda)),
    historico(db, tarefa.empresa_id, d.conversa.id, cfg.transcrever_audio),
  ]);
  const turnos = montarTurnos(hist.mensagens, avisoFollowup ?? undefined);
  if (!turnos) return { situacao: "ignorada", detalhe: "nada novo do cliente para responder" };

  const ctx: ContextoFerramenta = {
    admin: db,
    empresaId: tarefa.empresa_id,
    cfg,
    conversaId: d.conversa.id,
    leadId: d.conversa.crm_lead_id,
    contatoId: d.conversa.whatsapp_contact_id,
    agora: new Date(),
    ultimaDoCliente: hist.ultimaDoCliente,
    etapas,
    passagem: null,
    saida: [],
    agendouFollowup: false,
  };
  const cliente = new Anthropic();
  // Cache: as instruções fixas têm um ponto de cache próprio; a conversa entra no cache
  // automático (top-level), que avança a cada rodada. A hora e os dados do lead mudam a cada
  // resposta, então ficam DEPOIS da conversa (mensagem de sistema no fim), para não quebrar o cache.
  const momento = instrucoesDoMomento(new Date(), lead);
  const momentoNoMeio = !SEM_SISTEMA_NO_MEIO.includes(cfg.modelo);
  const sistema: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: instrucoesFixas(empresa), cache_control: { type: "ephemeral" } },
    ...(momentoNoMeio ? [] : [{ type: "text" as const, text: momento }]),
  ];
  const uso: Uso = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
  const ferramentasUsadas: Array<{ nome: string; entrada: unknown; resultado: string }> = [];
  const saida: Saida[] = [];
  /** Relatório que a IA escreveu para si ("Enviei ao Breno...", "Ficha do cliente..."): não vai. */
  const retidos: string[] = [];
  let parada: string | null = null;
  let modeloUsado = cfg.modelo;
  let rodadas = 0;
  const mensagens: Anthropic.Beta.BetaMessageParam[] = momentoNoMeio
    ? [...turnos, { role: "system", content: momento }]
    : [...turnos];

  while (rodadas < MAX_RODADAS) {
    rodadas++;
    const resposta = await cliente.beta.messages.create({
      model: cfg.modelo,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: cfg.esforco as "low" | "medium" | "high" },
      ...(COM_FALLBACK.includes(cfg.modelo)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      cache_control: { type: "ephemeral" },
      system: sistema,
      tools: ferramentas,
      messages: mensagens,
    });
    modeloUsado = resposta.model;
    uso.entrada += resposta.usage.input_tokens;
    uso.saida += resposta.usage.output_tokens;
    uso.cacheLeitura += resposta.usage.cache_read_input_tokens ?? 0;
    uso.cacheEscrita += resposta.usage.cache_creation_input_tokens ?? 0;
    parada = resposta.stop_reason;
    if (resposta.stop_reason === "refusal") break;

    // O que a IA escreve vai ao cliente, na ordem (menos relatório interno); depois, o que as
    // ferramentas pediram (enviar_mensagem, vídeo, áudio), na ordem das chamadas.
    for (const b of resposta.content) {
      if (b.type !== "text" || !b.text.trim()) continue;
      if (textoInterno(b.text, lead?.nome)) retidos.push(b.text.trim());
      else saida.push({ tipo: "texto", texto: b.text.trim() });
    }
    const chamadas = resposta.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (resposta.stop_reason !== "tool_use" || !chamadas.length) break;

    mensagens.push({ role: "assistant", content: resposta.content });
    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const c of chamadas) {
      const r = await executarFerramenta(ctx, c.name, c.input);
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
      saida.push(...ctx.saida.splice(0));
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

  const textos = saida.filter((s) => s.tipo === "texto");
  const semNada = saida.filter((s) => !(s.tipo === "texto" && s.texto.trim() === NADA));
  if (ehFollowup && !ctx.passagem && semNada.length === 0 && parada !== "refusal") {
    await db.from("ia_execucoes").insert({ ...registro, mensagens_enviadas: [] });
    await concluirRepescagem(db, tarefa, `${cfg.nome} avaliou que não era preciso enviar`, true);
    return { situacao: "concluida", detalhe: "follow-up dispensado pela IA" };
  }
  if (parada === "refusal" || (!textos.length && !saida.length && !ctx.passagem)) {
    await db.from("ia_execucoes").insert({ ...registro, erro: "sem resposta da IA" });
    if (ehFollowup) {
      await followupParaEquipe(db, tarefa, "a Alice não conseguiu escrever o toque");
      return { situacao: "ignorada", detalhe: "sem resposta da IA no follow-up" };
    }
    await socorroHumano(
      db,
      tarefa,
      "A Alice não soube responder esta mensagem. Por favor, assuma a conversa.",
    );
    return { situacao: "concluida", detalhe: "sem resposta: passada para humano" };
  }

  // Mensagem nova do cliente chegou enquanto a Alice pensava: a próxima tarefa responde tudo junto.
  const [{ data: novaTarefa }, { data: agora }, { data: passagem }] = await Promise.all([
    db
      .from("ia_tarefas")
      .select("id")
      .eq("conversa_id", d.conversa.id)
      .eq("tipo", "responder")
      .eq("situacao", "pendente")
      .maybeSingle(),
    db.from("conversas").select("status").eq("id", d.conversa.id).single(),
    db
      .from("ia_tarefas")
      .select("id")
      .eq("conversa_id", d.conversa.id)
      .eq("tipo", "passar_para_humano")
      .eq("situacao", "pendente")
      .maybeSingle(),
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
  // Equipe assumiu enquanto a Alice pensava (a passagem ainda não mudou a situação no Chatwoot).
  if (agora?.status !== "pending" || passagem) {
    await db.from("ia_execucoes").insert({ ...registro, erro: "descartada: humano assumiu" });
    return { situacao: "ignorada", detalhe: "humano assumiu durante o processamento" };
  }

  // Depois de um vídeo/áudio, o resto espera alguns minutos (o cliente vê o vídeo com calma e a
  // mídia, que demora a carregar no WhatsApp, não chega depois do orçamento).
  const iMidia = semNada.findIndex((s) => s.tipo === "anexo" && !s.semEspera);
  const espera = cfg.espera_apos_midia_segundos;
  const programar = !ctx.passagem && espera > 0 && iMidia >= 0 && iMidia < semNada.length - 1;
  const agoraItens = programar ? semNada.slice(0, iMidia + 1) : semNada;
  const depoisItens = programar ? semNada.slice(iMidia + 1) : [];

  const enviadas = await enviarItens(db, tarefa.empresa_id, d, agoraItens);
  if (depoisItens.length) {
    await db.from("ia_tarefas").insert({
      empresa_id: tarefa.empresa_id,
      conversa_id: d.conversa.id,
      tipo: "enviar_mensagens",
      executar_apos: new Date(Date.now() + espera * 1000).toISOString(),
      motivo: "resto da resposta, depois do vídeo/áudio",
      dados: { itens: depoisItens } as never,
    });
    ctx.agendouFollowup = true; // entrega à fila no fim
    enviadas.push(
      ...depoisItens.map((i) =>
        i.tipo === "texto" ? `[em ${espera}s] ${i.texto}` : `[em ${espera}s] [mídia] ${i.nome}`,
      ),
    );
  }
  await db.from("ia_execucoes").insert({
    ...registro,
    mensagens_enviadas: [...enviadas, ...retidos.map((t) => `[não enviado: texto interno] ${t}`)],
  });

  if (d.conversa.crm_lead_id) {
    await db
      .from("crm_leads")
      .update({ last_interaction_at: new Date().toISOString() })
      .eq("id", d.conversa.crm_lead_id)
      .eq("empresa_id", tarefa.empresa_id);
  }
  if (ehFollowup) await concluirRepescagem(db, tarefa, `Enviado pela ${cfg.nome}`, false);

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

  if (ctx.agendouFollowup) {
    const { enfileirarPendentes } = await import("./fila.server");
    await enfileirarPendentes(db);
  }

  if (ctx.passagem) {
    const { motivo, resumo } = ctx.passagem;
    await enviarMensagem(
      d.conta,
      d.tokenRobo,
      d.conversa.chatwoot_conversation_id,
      `🤖 ${cfg.nome} passou a conversa para a equipe.\nMotivo: ${motivo}\nResumo: ${resumo}`,
      true,
    );
    await cancelarFollowupPendente(
      db,
      tarefa.empresa_id,
      d.conversa.id,
      "transferida para a equipe",
    );
    if (d.conversa.crm_lead_id) {
      const quando = new Date().toISOString();
      await db.from("crm_followups").insert({
        empresa_id: tarefa.empresa_id,
        crm_lead_id: d.conversa.crm_lead_id,
        scheduled_at: quando,
        responsavel: "equipe",
        notes: `🤖 ${cfg.nome} transferiu: ${motivo}. ${resumo}`,
      });
      await db
        .from("crm_leads")
        .update({ next_follow_up_at: quando })
        .eq("id", d.conversa.crm_lead_id)
        .eq("empresa_id", tarefa.empresa_id);
    }
    await mudarSituacao(d.conta, d.tokenRobo, d.conversa.chatwoot_conversation_id, "open");
    await db.from("conversas").update({ status: "open" }).eq("id", d.conversa.id);
    return { situacao: "concluida", detalhe: `transferida para a equipe: ${motivo}` };
  }
  return { situacao: "concluida", detalhe: `${enviadas.length} mensagem(ns) enviada(s)` };
}

// ---------------------------------------------------------------- envio
/** Tempo para a mensagem enviada voltar pelo webhook e entrar no histórico. */
const ESPERA_WEBHOOK_MS = 2500;

/** Envia textos (divididos em mensagens) e mídias, na ordem. */
async function enviarItens(
  db: Admin,
  empresaId: string,
  d: DadosConversa,
  itens: Saida[],
): Promise<string[]> {
  const enviadas: string[] = [];
  if (!d.tokenRobo) return enviadas;
  for (const item of itens) {
    if (enviadas.length >= MAX_MENSAGENS_POR_RESPOSTA) break;
    if (item.tipo === "texto") {
      const partes = item.bloco ? [limparTexto(item.texto)] : dividirResposta(item.texto);
      for (const parte of partes) {
        if (enviadas.length >= MAX_MENSAGENS_POR_RESPOSTA) break;
        await enviarMensagem(d.conta, d.tokenRobo, d.conversa.chatwoot_conversation_id, parte);
        enviadas.push(parte);
      }
    } else {
      const { data: arquivo, error } = item.googleDoc
        ? await pdfDoGoogle(db, empresaId, item.caminho)
        : await db.storage.from(item.pasta ?? "alice-midias").download(item.caminho);
      if (error || !arquivo) {
        console.error("Alice: mídia não encontrada", item.nome, error?.message);
        continue;
      }
      await enviarAnexo(
        d.conta,
        d.tokenRobo,
        d.conversa.chatwoot_conversation_id,
        arquivo,
        item.nome,
      );
      enviadas.push(`[mídia] ${item.nome}`);
    }
  }
  return enviadas;
}

/** Documento da OS (Google Docs) em PDF, com a conta Google da empresa. */
async function pdfDoGoogle(
  db: Admin,
  empresaId: string,
  docId: string,
): Promise<{ data: Blob | null; error: { message: string } | null }> {
  try {
    const { executarNaEmpresa } = await import("@/lib/request-db.server");
    const { exportarPdf } = await import("@/lib/google-docs.server");
    const pdf = await executarNaEmpresa({ db, empresaId, userId: "" }, () => exportarPdf(docId));
    return { data: pdf, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

function itensDaTarefa(t: Tarefa): Saida[] {
  const itens = (t.dados as { itens?: Saida[] } | null)?.itens;
  return Array.isArray(itens) ? itens : [];
}

/** Hora de mandar o resto da resposta (depois do vídeo). Só se a conversa ainda está com a Alice. */
async function enviarProgramadas(db: Admin, tarefa: Tarefa): Promise<ResultadoTarefa> {
  const d = await dadosConversa(db, tarefa);
  if (d.contato?.ia_desligada)
    return { situacao: "ignorada", detalhe: "IA desligada para o cliente" };
  if (d.conversa.status !== "pending")
    return { situacao: "ignorada", detalhe: "conversa com a equipe: não enviado" };
  const enviadas = await enviarItens(db, tarefa.empresa_id, d, itensDaTarefa(tarefa));
  return { situacao: "concluida", detalhe: `${enviadas.length} mensagem(ns) enviada(s)` };
}

/**
 * O cliente escreveu antes da hora: manda já o que estava programado, para a próxima resposta
 * continuar dali. Devolve se enviou algo.
 */
async function descarregarProgramadas(db: Admin, empresaId: string, d: DadosConversa) {
  const { data: pendentes } = await db
    .from("ia_tarefas")
    .update({ situacao: "processando", iniciada_em: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .eq("conversa_id", d.conversa.id)
    .eq("tipo", "enviar_mensagens")
    .eq("situacao", "pendente")
    .select("*");
  let enviou = false;
  for (const t of (pendentes ?? []) as Tarefa[]) {
    const enviadas = await enviarItens(db, empresaId, d, itensDaTarefa(t));
    enviou ||= enviadas.length > 0;
    await concluir(db, t.id, "concluida", "enviada antes da hora: o cliente escreveu");
  }
  return enviou;
}
