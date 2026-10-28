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
import { cupomNoTexto } from "./cupons";
import {
  cancelarFollowupPendente,
  cuponsAtivos,
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
  instrucoesDosModulos,
  montarTurnos,
  type ContextoEmpresa,
  type ContextoLead,
  type MensagemHistorico,
  type Uso,
  janelaEstavel,
  marcarCacheDoHistorico,
  tecidoDaConfig,
} from "./prompt";
import { chavesValidas, modulosDaConfig } from "./modulos";
import { aplicarCamposDoRoteiro } from "./campos-roteiro";
import { AVISO_PRECO_TRAVADO, precoLiberado, temPreco } from "./preco-depois";
import { chaveTelefone } from "@/lib/avisos";
import {
  TEXTO_AUDIO_SEM_TRANSCRICAO,
  dentroDaJanela,
  dentroDoHorario,
  proximoHorarioPermitido,
  textoInterno,
  ultimaEhAudioSemTranscricao,
} from "./regras";
import { primeiroNomeLimpo } from "./nome";
import {
  GUIA_TOQUE_AUDIO,
  PASSO_RETORNO_COMBINADO,
  passoDaEtapa,
  toqueEmAudio,
  type Passo,
} from "./cadencia";
import {
  MOTIVO_DO_CONTEXTO,
  ROTULO_CONTEXTO,
  ehConcorrencia,
  type ClasseContexto,
} from "./contexto-toque";
import type { DadosCadencia } from "./cadencia.server";
import { causaDaParadaVoz, notaParadaConversa } from "./parada-ia";
import { ParadaIa, chamarIa, encerrarParadas, registrarParada } from "./parada-ia.server";
import { USD_POR_MIL_CREDITOS_PADRAO } from "./voz";
import {
  CONFIRMACAO_DESCADASTRO,
  confirmacaoPendente,
  INSTRUCAO_DESCADASTRO,
  soPedidoDeSaida,
} from "@/lib/descadastro";

type Admin = SupabaseClient<Database>;
import { instrucaoDemora, notaDevolucao } from "./devolucao";

type Tarefa = Database["public"]["Tables"]["ia_tarefas"]["Row"];

const MAX_RODADAS = 8;
/** Mensagens mais recentes que a Alice lê (o resumo do lead guarda o resto). */
const MAX_HISTORICO = 20;
/** Com o cache do histórico: busca até 200 e manda a janela estável (20 a 40 mensagens). */
const MAX_HISTORICO_BUSCA = 200;
const MAX_IMAGENS = 4;
const MAX_AUDIOS_TRANSCRITOS = 3;
const MAX_MENSAGENS_POR_RESPOSTA = 10;
const MAX_BYTES_IMAGEM = 4_500_000;
const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
/** Modelos que aceitam o fallback automático do servidor quando recusam ("default"). */
/** Regra do nome do cliente (nome confirmado x perfil), para todas as empresas. */
const REGRA_NOME = true;
/** Regras de 26/10 (não perguntar duas vezes; tecido não identificado): ligadas em 26/10. */
const REGRA_RESPOSTAS = true;
/** Regra nº 1 (26/10): nunca preço antes de valor (regra nas instruções + trava do orçamento). */
const REGRA_PRECO_DEPOIS = true;
/**
 * Custo, ideia 2 (26/10): histórico em janela que anda de 20 em 20 (até 40 mensagens) e ponto de
 * cache de 1 hora no fim do histórico. Desligado por padrão; ligado por empresa (abaixo).
 */
export const CACHE_HISTORICO = false;
/** Empresas com a ideia 2 ligada (26/10: Turbine, sem ensaio; mede 2–3 dias contra US$ 0,24). */
const CACHE_HISTORICO_EMPRESAS = new Set(["11111111-1111-1111-1111-111111111111"]);

export function cacheDoHistorico(empresaId: string): boolean {
  return CACHE_HISTORICO || CACHE_HISTORICO_EMPRESAS.has(empresaId);
}

export const COM_FALLBACK = ["claude-opus-5", "claude-opus-5-5", "claude-sonnet-5-5"];
/** Modelos sem mensagem de sistema no meio da conversa: o momento vai no bloco de sistema. */
export const SEM_SISTEMA_NO_MEIO = ["claude-sonnet-5"];
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
  if (!tarefa?.id) {
    // A reserva pode ter adiado a tarefa (outra resposta da mesma conversa em andamento):
    // ela volta para a fila no novo horário.
    const { enfileirarPendentes } = await import("./fila.server");
    await enfileirarPendentes(db);
    return { situacao: "ignorada", detalhe: "tarefa não está pronta ou já foi feita" };
  }

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
    // Sem crédito ou chave recusada na conta da IA: registra a parada (avisa a Nexa e a empresa).
    const parada = e instanceof ParadaIa ? e.causa : null;
    if (parada) await registrarParada(db, tarefa.empresa_id, "ia", parada, tarefa.conversa_id);
    if (tarefa.tipo === "followup") {
      await followupParaEquipe(
        db,
        tarefa,
        parada
          ? "a Alice está pausada (conta da IA sem crédito ou chave recusada)"
          : "a Alice teve um erro técnico no follow-up",
      ).catch(() => undefined);
    } else {
      await socorroHumano(
        db,
        tarefa,
        parada
          ? notaParadaConversa(parada)
          : "A Alice teve um problema técnico e não conseguiu responder.",
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
    /** O cliente pediu "manda por escrito": sem áudio nesta conversa. */
    alice_so_texto_em?: string | null;
    /** Módulos do roteiro já carregados nesta conversa. */
    alice_modulos?: string[] | null;
  };
  conta: Conta;
  tokenRobo: string | null;
  tokenAdmin: string | null;
  /** Agente-robô da Alice no Chatwoot (responsável que não é "dono" da conversa). */
  botId?: number | null;
  contato: {
    ia_desligada: boolean;
    sem_pos_venda: boolean;
    normalized_phone: string;
    marketing_optout_em: string | null;
    marketing_optout_origem: string | null;
    marketing_optout_confirmado_em: string | null;
  } | null;
};

async function dadosConversa(db: Admin, tarefa: Tarefa): Promise<DadosConversa> {
  const { data: conversa } = await db
    .from("conversas")
    .select(
      "id, chatwoot_conversation_id, status, crm_lead_id, conexao_id, whatsapp_contact_id, alice_so_texto_em, alice_modulos, assumida_por, responsavel_id",
    )
    .eq("id", tarefa.conversa_id)
    .eq("empresa_id", tarefa.empresa_id)
    .single();
  if (!conversa) throw new Error("conversa não encontrada");
  const [{ data: conexao }, { data: segredos }, { data: contato }] = await Promise.all([
    db
      .from("chatwoot_conexoes")
      .select("base_url, account_id, alice_bot_id")
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
          .select(
            "ia_desligada, sem_pos_venda, normalized_phone, marketing_optout_em, marketing_optout_origem, marketing_optout_confirmado_em",
          )
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
    botId: conexao.alice_bot_id == null ? null : Number(conexao.alice_bot_id),
  };
}

/** Push "Conversa nova para a equipe" na hora em que a Alice passa a conversa (item 5). */
async function avisarPassagem(db: Admin, empresaId: string, conversaId: string, motivo: string) {
  const { avisarEquipePassagem } = await import("@/lib/push/avisos-conversa.server");
  await avisarEquipePassagem(db, { empresaId, conversaId, motivo });
}

async function passarParaHumano(db: Admin, tarefa: Tarefa): Promise<ResultadoTarefa> {
  const d = await dadosConversa(db, tarefa);
  const token = d.tokenRobo ?? d.tokenAdmin;
  if (!token) return { situacao: "ignorada", detalhe: "sem token do Chatwoot" };
  const nota = (tarefa.dados as { nota?: string } | null)?.nota;
  if (nota) await enviarMensagem(d.conta, token, d.conversa.chatwoot_conversation_id, nota, true);
  await mudarSituacao(d.conta, token, d.conversa.chatwoot_conversation_id, "open");
  await db.from("conversas").update({ status: "open" }).eq("id", d.conversa.id);
  await avisarPassagem(db, tarefa.empresa_id, d.conversa.id, tarefa.motivo ?? "atendimento humano");
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
  const { clienteEsperandoNaConversa, responderAgora } = await import("./devolucao.server");
  const esperando = await clienteEsperandoNaConversa(db as never, d.conversa.id);
  await enviarMensagem(d.conta, token, conversa, notaDevolucao(cfg.nome, esperando), true);
  // Cliente esperando: ela responde agora (já existir uma resposta pendente está ok).
  if (esperando) await responderAgora(db as never, tarefa.empresa_id, d.conversa.id);
  return { situacao: "concluida", detalhe: "conversa devolvida para a Alice" };
}

/** Nota para a equipe quando a franquia não deixa a Alice responder (null = pode responder). */
async function conferirFranquia(
  db: Admin,
  empresaId: string,
  conversaId: string,
): Promise<string | null> {
  const { data, error } = await db.rpc(
    "alice_pode_responder" as never,
    {
      _emp: empresaId,
      _conversa: conversaId,
    } as never,
  );
  if (error) {
    console.error("Alice: franquia não conferida", error.message);
    return null;
  }
  const r = data as { pode?: boolean; nota?: string } | null;
  return r && r.pode === false ? (r.nota ?? "Franquia da Alice: conversa com a equipe.") : null;
}

/** Em erro: nota privada explicando e conversa para humano. */
async function socorroHumano(db: Admin, tarefa: Tarefa, nota: string) {
  const d = await dadosConversa(db, tarefa);
  const token = d.tokenRobo ?? d.tokenAdmin;
  if (!token) return;
  await enviarMensagem(d.conta, token, d.conversa.chatwoot_conversation_id, `🤖 ${nota}`, true);
  await mudarSituacao(d.conta, token, d.conversa.chatwoot_conversation_id, "open");
  await db.from("conversas").update({ status: "open" }).eq("id", d.conversa.id);
  await avisarPassagem(db, tarefa.empresa_id, d.conversa.id, nota);
}

// ---------------------------------------------------------------- contexto
export async function etapasAbertas(db: Admin, empresaId: string): Promise<string[]> {
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

export async function contextoEmpresa(
  db: Admin,
  empresaId: string,
  cfg: ConfigIa,
  ferramentas: string[],
): Promise<ContextoEmpresa> {
  const [empresa, config, precos, servicos, equipe, modelos, regrasPreco] = await Promise.all([
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
    // Modelos da OS: com o modelo do termo de garantia, a Alice conhece as regras da garantia.
    db
      .from("app_settings")
      .select("value")
      .eq("empresa_id", empresaId)
      .eq("key", "os_document_settings")
      .maybeSingle(),
    db
      .from("orcamento_configuracoes")
      .select(
        "classe_ligada, classe_a_pct, acrescimos_ligado, almofadas_soltas_pct, encardido_pct, dupla_face_ligada, dupla_face_pct",
      )
      .eq("empresa_id", empresaId)
      .maybeSingle(),
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
    camposRoteiro: {
      regiao_atendida: cfg.regiao_atendida ?? "",
      nomes_atendentes: cfg.nomes_atendentes ?? "",
      anos_experiencia: cfg.anos_experiencia ?? "",
    },
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
    acrescimosPreco:
      regrasPreco.data && (regrasPreco.data.classe_ligada || regrasPreco.data.acrescimos_ligado)
        ? {
            classeAPct: regrasPreco.data.classe_ligada
              ? Number(regrasPreco.data.classe_a_pct)
              : null,
            almofadasPct: regrasPreco.data.acrescimos_ligado
              ? Number(regrasPreco.data.almofadas_soltas_pct)
              : null,
            encardidoPct: regrasPreco.data.acrescimos_ligado
              ? Number(regrasPreco.data.encardido_pct)
              : null,
          }
        : null,
    garantiaImpermeabilizacao: Boolean(
      (modelos.data?.value as { templateGarantia?: string } | null)?.templateGarantia,
    ),
    tecidoNaoIdentificado: tecidoDaConfig(cfg.tecido_nao_identificado),
    modulos: modulosDaConfig(cfg.modulos),
    duplaFacePct: regrasPreco.data?.dupla_face_ligada
      ? Number(regrasPreco.data.dupla_face_pct)
      : null,
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
  // Cupom citado na primeira mensagem recebida (ex.: "Vi o cupom BLOG50 no blog…").
  const [{ data: primeira }, cupons] = await Promise.all([
    db
      .from("whatsapp_messages")
      .select("text_content")
      .eq("crm_lead_id", leadId)
      .eq("empresa_id", empresaId)
      .eq("direction", "Recebida")
      .order("message_timestamp")
      .limit(1)
      .maybeSingle(),
    cuponsAtivos(db, empresaId),
  ]);
  const cupomCitado = cupomNoTexto(primeira?.text_content, cupons)?.codigo ?? null;
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
      clienteId: l.customer_id,
      semPosVenda,
      cupomCitado,
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
  estavel = CACHE_HISTORICO,
): Promise<{ mensagens: MensagemHistorico[]; ultimaDoCliente: Date | null; truncado: boolean }> {
  const { data } = await db
    .from("whatsapp_messages")
    .select(
      "id, direction, text_content, message_type, remetente_tipo, raw_event_reference, message_timestamp, transcricao, chatwoot_message_id",
    )
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .eq("privada", false)
    .order("message_timestamp", { ascending: false })
    .limit(estavel ? MAX_HISTORICO_BUSCA : MAX_HISTORICO);
  const linhas = estavel ? janelaEstavel((data ?? []).reverse()) : (data ?? []).reverse();
  // Conversa maior que a janela: o começo (apresentação e diagnóstico) ficou de fora.
  const truncado =
    (data ?? []).length >= (estavel ? MAX_HISTORICO_BUSCA : MAX_HISTORICO) ||
    linhas.length < (data ?? []).length;
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

  // Áudios da própria Alice (resposta em áudio): o texto falado fica no registro de uso.
  const audiosAlice = linhas.filter(
    (m) =>
      m.direction !== "Recebida" &&
      m.message_type === "Áudio" &&
      !m.transcricao &&
      m.chatwoot_message_id !== null,
  );
  if (audiosAlice.length) {
    const { data: usos } = await db
      .from("ia_audios_uso")
      .select("chatwoot_message_id, texto_falado")
      .eq("empresa_id", empresaId)
      .in(
        "chatwoot_message_id",
        audiosAlice.map((m) => m.chatwoot_message_id as number),
      );
    const falado = new Map((usos ?? []).map((u) => [u.chatwoot_message_id, u.texto_falado]));
    for (const m of audiosAlice) {
      const t = falado.get(m.chatwoot_message_id);
      if (!t) continue;
      m.transcricao = t;
      await db
        .from("whatsapp_messages")
        .update({ transcricao: t })
        .eq("id", m.id)
        .eq("empresa_id", empresaId);
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
    truncado,
  };
}

// ---------------------------------------------------------------- tarefas
export async function lerConfig(db: Admin, empresaId: string) {
  const [{ data }, { data: operante }, { data: comAlice }] = await Promise.all([
    db.from("ia_configuracoes").select("*").eq("empresa_id", empresaId).maybeSingle(),
    db.rpc("empresa_operante" as never, { _emp: empresaId } as never),
    db.rpc("empresa_tem_recurso" as never, { _emp: empresaId, _recurso: "alice" } as never),
  ]);
  // Empresa em implantação (não liberada pela Nexa), em somente leitura, cancelada ou com plano
  // sem a Alice: a Alice não atende.
  if (data && (operante !== true || comAlice !== true)) return { ...data, ativo: false };
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
  // Técnico da equipe (agenda no WhatsApp): a Alice não responde.
  const { conversaDaAgenda, numeroEhDeTecnico } = await import("@/lib/agenda-tecnicos.server");
  if (
    (await numeroEhDeTecnico(db, tarefa.empresa_id, d.contato?.normalized_phone)) ||
    (await conversaDaAgenda(db, tarefa.empresa_id, d.conversa.chatwoot_conversation_id))
  )
    return { situacao: "ignorada", detalhe: "técnico da equipe (agenda)" };
  // Dia do serviço: fica com a equipe (chegada do técnico, dúvidas); a Alice não manda nada.
  const { servicoHoje } = await import("./pos-resposta.server");
  const osHoje = await servicoHoje(db, tarefa.empresa_id, d.contato?.normalized_phone);
  if (osHoje) {
    await socorroHumano(
      db,
      tarefa,
      `Hoje é o dia do serviço da OS ${osHoje}: a Alice não responde e a conversa fica com a equipe.`,
    );
    return { situacao: "concluida", detalhe: `dia do serviço (OS ${osHoje}): com a equipe` };
  }
  // O cliente acabou de pedir para sair do marketing: a Alice confirma uma vez. Só o pedido →
  // texto fixo, sem IA; pedido com outro assunto → confirma e responde o resto.
  if (
    d.conversa.whatsapp_contact_id &&
    confirmacaoPendente(d.contato, Boolean(cfg.descadastro_resposta), new Date())
  ) {
    const { marcarConfirmado, textoDoClienteAgora } = await import("./descadastro.server");
    const texto = await textoDoClienteAgora(db, tarefa.empresa_id, d.conversa.id);
    await marcarConfirmado(db, tarefa.empresa_id, d.conversa.whatsapp_contact_id);
    if (soPedidoDeSaida(texto)) {
      if (!d.tokenRobo) throw new Error("robô da Alice não configurado no Chatwoot");
      await enviarMensagem(
        d.conta,
        d.tokenRobo,
        d.conversa.chatwoot_conversation_id,
        CONFIRMACAO_DESCADASTRO,
      );
      return { situacao: "concluida", detalhe: "descadastro de marketing confirmado" };
    }
    return conversar(db, tarefa, cfg, d, null, INSTRUCAO_DESCADASTRO);
  }
  // Cliente esperou (devolvida pela equipe, pausa da IA): desculpa natural pela demora.
  const { data: ultimaDoCliente } = await db
    .from("whatsapp_messages")
    .select("message_timestamp")
    .eq("conversa_id", d.conversa.id)
    .eq("direction", "Recebida")
    .eq("privada", false)
    .order("message_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  const demora = instrucaoDemora(ultimaDoCliente?.message_timestamp ?? null, new Date());
  return demora ? conversar(db, tarefa, cfg, d, null, demora) : conversar(db, tarefa, cfg, d, null);
}

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
      canal: "equipe",
      notes: `${f.notes ?? ""}\nFicou para a equipe: ${motivo}.`.trim(),
    })
    .eq("id", f.id);
}

/** Toque cancelado pela trava (o motivo fica no follow-up). */
async function cancelarToque(db: Admin, tarefa: Tarefa, motivo: string) {
  await db
    .from("crm_followups")
    .update({ status: "Cancelada", completed_at: new Date().toISOString(), result: motivo })
    .eq("empresa_id", tarefa.empresa_id)
    .eq("ia_tarefa_id", tarefa.id)
    .eq("status", "Pendente");
}

/** Toque bloqueado pelo contexto: cancela, sugere o motivo e, se foi concorrência, avisa urgente. */
async function bloquearPorContexto(
  db: Admin,
  tarefa: Tarefa,
  d: DadosConversa,
  lido: { classe: Exclude<ClasseContexto, "segue">; trecho: string },
): Promise<ResultadoTarefa> {
  const motivo = `contexto: cliente ${ROTULO_CONTEXTO[lido.classe]}${lido.trecho ? ` ("${lido.trecho}")` : ""}`;
  await cancelarToque(db, tarefa, motivo);
  const leadId = d.conversa.crm_lead_id;
  if (leadId) {
    await db
      .from("crm_leads")
      .update({
        sem_desfecho_sugerido: MOTIVO_DO_CONTEXTO[lido.classe],
        desfecho_obs: lido.trecho || null,
        next_follow_up_at: null,
      })
      .eq("id", leadId)
      .eq("empresa_id", tarefa.empresa_id)
      .is("loss_reason_id", null);
  }
  if (ehConcorrencia(lido.classe)) {
    const { avisarConcorrencia } = await import("./concorrencia.server");
    await avisarConcorrencia(db as never, {
      empresaId: tarefa.empresa_id,
      conversaId: d.conversa.id,
      leadId,
      frase: lido.trecho || ROTULO_CONTEXTO[lido.classe],
    });
  }
  return { situacao: "ignorada", detalhe: `toque cancelado: ${motivo}` };
}

async function fazerFollowup(db: Admin, tarefa: Tarefa): Promise<ResultadoTarefa> {
  const cfg = await lerConfig(db, tarefa.empresa_id);
  if (!cfg?.ativo) {
    await followupParaEquipe(db, tarefa, "Alice desligada");
    return { situacao: "ignorada", detalhe: "Alice desligada" };
  }
  const d = await dadosConversa(db, tarefa);
  const dados = (tarefa.dados ?? {}) as DadosCadencia;
  const passo = dados.cadencia ? passoDaEtapa(dados.etapa) : null;
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
  // Trava antes de cada toque (C/D): equipe assumiu ou escreveu, OS/visita/agendamento, lead
  // ganho/perdido/adiou, descadastro, IA desligada ou sem pós-venda → não manda e registra o motivo.
  const { travaDoToque } = await import("./cadencia.server");
  const trava = await travaDoToque(db, {
    empresaId: tarefa.empresa_id,
    conversa: d.conversa,
    contato: d.contato,
    desde: new Date(tarefa.created_at),
    botId: d.botId ?? null,
  });
  if (trava) {
    await cancelarToque(db, tarefa, trava);
    return { situacao: "ignorada", detalhe: `toque cancelado: ${trava}` };
  }
  // Contexto (27/10): o cliente já disse que fechou com outra empresa, achou mais barato, já fez,
  // não quer ou pediu para parar? O toque não sai e o lead vai para "Sem desfecho".
  if (!passo?.fim) {
    const { contextoDoCliente } = await import("./contexto-toque.server");
    const lido = await contextoDoCliente(db as never, {
      empresaId: tarefa.empresa_id,
      contatoId: d.conversa.whatsapp_contact_id,
      conversaId: d.conversa.id,
    });
    const classe = lido?.classe ?? "segue";
    if (lido && classe !== "segue")
      return bloquearPorContexto(db, tarefa, d, { classe, trecho: lido.trecho });
  }
  // Fim da trilha sem resposta: o lead vai para "Orçamentos sem desfecho".
  if (passo?.fim) {
    if (d.conversa.crm_lead_id) {
      const { marcarSemDesfecho } = await import("./cadencia.server");
      await marcarSemDesfecho(db, tarefa.empresa_id, d.conversa.crm_lead_id, passo.trilha);
    }
    await concluirRepescagem(db, tarefa, `sem desfecho: ${passo.guia}`, false);
    return { situacao: "concluida", detalhe: `fim da trilha ${passo.trilha}: sem desfecho` };
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
    if (dentroDaJanela(ultimaDoCliente, depois) || passo || dados.trilha === "C") {
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
    if (passo) return toqueForaDaJanela(db, tarefa, cfg, d, passo, dados);
    // Retorno combinado fora da janela: o modelo fu_retorno_combinado (ou a equipe, sem ele).
    if (dados.trilha === "C")
      return toqueForaDaJanela(db, tarefa, cfg, d, PASSO_RETORNO_COMBINADO, dados);
    await followupParaEquipe(
      db,
      tarefa,
      "passou a janela de 24 h do WhatsApp (precisa de modelo aprovado)",
    );
    return { situacao: "ignorada", detalhe: "fora da janela de 24 h do WhatsApp" };
  }

  // Toque do dia seguinte em áudio (D1 10h): nunca dois áudios seguidos sem resposta.
  let toqueAudio = false;
  if (passo && cfg.toque_d1_audio) {
    const { data: ultimaAlice } = await db
      .from("whatsapp_messages")
      .select("message_type, message_timestamp")
      .eq("empresa_id", tarefa.empresa_id)
      .eq("conversa_id", d.conversa.id)
      .eq("direction", "Enviada")
      .eq("remetente_tipo", "agent_bot")
      .eq("privada", false)
      .order("message_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    toqueAudio = toqueEmAudio({
      etapa: passo.etapa,
      ligado: cfg.toque_d1_audio,
      audioAtivo: cfg.audio_ativo,
      soTexto: Boolean(d.conversa.alice_so_texto_em),
      audioSemResposta: Boolean(
        ultimaAlice?.message_type === "Áudio" &&
        (!ultimaDoCliente || ultimaDoCliente.getTime() < Date.parse(ultimaAlice.message_timestamp)),
      ),
    });
  }
  const aviso = passo
    ? avisoDoToque(passo, cfg, toqueAudio)
    : [
        `Hora do follow-up agendado (trilha ${dados.trilha ?? "?"}): ${dados.motivo ?? tarefa.motivo ?? "cliente sem responder"}.`,
        dados.mensagem_sugerida ? `Sugestão anotada: "${dados.mensagem_sugerida}".` : null,
        "O cliente não respondeu desde a última mensagem da empresa. Faça agora o toque de follow-up, seguindo as instruções (algo novo, uma pergunta só). Se as instruções mandarem fazer algo neste toque (ex.: mandar o orçamento), use as ferramentas normalmente.",
        `Se não fizer sentido mandar nada (por exemplo, o atendimento já foi encerrado), responda exatamente ${NADA}.`,
        cfg.cadencia_followup
          ? "Não agende o próximo toque: o sistema agenda sozinho."
          : "Se for o caso, agende o próximo toque com agendar_followup.",
      ]
        .filter(Boolean)
        .join(" ");
  // A trava já passou (ninguém assumiu nem escreveu): a resposta do cliente vem para a Alice.
  if (passo) await voltarParaAliceNoToque(db, d);
  return conversar(db, tarefa, cfg, d, aviso, undefined, { toqueAudio });
}

/** Instrução do toque da cadência dentro da janela de 24 h (a Alice escreve, adaptando o guia). */
function avisoDoToque(
  passo: Passo,
  cfg: NonNullable<Awaited<ReturnType<typeof lerConfig>>>,
  toqueAudio = false,
) {
  const valor = Number(cfg.oferta_followup_valor ?? 0);
  const condicao =
    cfg.oferta_followup_tipo === "reais"
      ? valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : `${valor.toLocaleString("pt-BR")}%`;
  return [
    `Hora do toque ${passo.etapa} da trilha ${passo.trilha} (cadência do sistema). O cliente não respondeu desde a última mensagem da empresa.`,
    `O que dizer (adapte à conversa, com o nome se tiver): "${passo.guia}"`,
    passo.oferta
      ? `A condição é ${condicao} de desconto sobre o valor do orçamento, válida até amanhã. Não diga o valor da condição nesta mensagem; se o cliente quiser ver, refaça o orçamento com criar_orcamento e desconto "oferta_followup".`
      : null,
    toqueAudio ? GUIA_TOQUE_AUDIO : null,
    'Uma pergunta só, nunca "está aí?" nem só o nome com interrogação.',
    `Se não fizer sentido mandar (atendimento encerrado, cliente já decidiu), responda exatamente ${NADA}.`,
    "Não agende o próximo toque: o sistema agenda sozinho.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Toque da cadência fora da janela de 24 h: modelo aprovado da Meta (com a cadência de modelos
 * ligada) ou tarefa da equipe. Nos dois casos, o próximo toque já fica agendado.
 */
async function toqueForaDaJanela(
  db: Admin,
  tarefa: Tarefa,
  cfg: NonNullable<Awaited<ReturnType<typeof lerConfig>>>,
  d: DadosConversa,
  passo: Passo,
  dados: DadosCadencia,
): Promise<ResultadoTarefa> {
  const { enviarToqueModelo, seguirCadencia } = await import("./cadencia.server");
  let resultado: ResultadoTarefa;
  const nomeCliente = await primeiroNomeDoLead(db, tarefa.empresa_id, d.conversa.crm_lead_id);
  // Retorno combinado: {{2}} é uma frase curta escrita na hora (fica gravada na tarefa).
  let retorno: { modelo: string; valores: string[]; frase: string } | null = null;
  if (passo.etapa === "RC" && cfg.followup_modelos) {
    const { fraseDoRetorno } = await import("./retorno-combinado.server");
    const { modeloDoRetorno } = await import("./retorno-combinado");
    const frase = await fraseDoRetorno(db as never, {
      empresaId: tarefa.empresa_id,
      contatoId: d.conversa.whatsapp_contact_id,
      conversaId: d.conversa.id,
      motivo: dados.motivo ?? tarefa.motivo,
      sugestao: dados.mensagem_sugerida ?? null,
    });
    retorno = { ...modeloDoRetorno(nomeCliente, frase), frase };
    await db
      .from("ia_tarefas")
      .update({
        dados: { ...dados, frase_retorno: frase, modelo_retorno: retorno.modelo } as never,
      })
      .eq("id", tarefa.id);
  }
  const envio =
    cfg.followup_modelos && passo.modelo
      ? await enviarToqueModelo(db, {
          empresaId: tarefa.empresa_id,
          chatwootConversa: d.conversa.chatwoot_conversation_id,
          nomeCliente,
          passo,
          ...(retorno ? { modelo: retorno.modelo, valores: retorno.valores } : {}),
        }).catch((e) => ({
          ok: false as const,
          motivo: `falha ao mandar o modelo: ${e instanceof Error ? e.message : String(e)}`,
        }))
      : {
          ok: false as const,
          motivo: passo.modelo
            ? "modelos fora da janela desligados"
            : "toque sem modelo fora da janela de 24 h",
        };
  if (envio.ok) {
    await db
      .from("crm_followups")
      .update({ canal: "modelo", modelo: envio.modelo })
      .eq("empresa_id", tarefa.empresa_id)
      .eq("ia_tarefa_id", tarefa.id);
    await concluirRepescagem(db, tarefa, `Modelo ${envio.modelo} enviado`, false);
    await voltarParaAliceNoToque(db, d);
    await enviarNota(
      d,
      `🤖 Toque ${passo.etapa} (fora da janela de 24 h) pelo modelo ${envio.modelo}: ${envio.texto}`,
    );
    resultado = {
      situacao: "concluida",
      detalhe: `toque ${passo.etapa} pelo modelo ${envio.modelo}`,
    };
  } else {
    await followupParaEquipe(
      db,
      tarefa,
      `toque ${passo.etapa} fora da janela de 24 h (${envio.motivo}). Sugestão: ${passo.guia}`,
    );
    resultado = {
      situacao: "ignorada",
      detalhe: `toque ${passo.etapa} para a equipe: ${envio.motivo}`,
    };
  }
  if (
    await seguirCadencia(db, {
      empresaId: tarefa.empresa_id,
      conversaId: d.conversa.id,
      leadId: d.conversa.crm_lead_id,
      cfg,
      atual: dados,
    })
  ) {
    const { enfileirarPendentes } = await import("./fila.server");
    await enfileirarPendentes(db);
  }
  return resultado;
}

/**
 * Toque mandado numa conversa que não está com a Alice (aberta sem dono ou encerrada): a conversa
 * volta para ela, para a resposta do cliente cair com a Alice (como no pós-venda e no lead do
 * site). Antes, a resposta ficava com a equipe e ninguém via (27/10, retomada).
 */
async function voltarParaAliceNoToque(db: Admin, d: DadosConversa) {
  if (d.conversa.status === "pending") return;
  const token = d.tokenAdmin ?? d.tokenRobo;
  if (token)
    await mudarSituacao(d.conta, token, d.conversa.chatwoot_conversation_id, "pending").catch((e) =>
      console.error("Alice: conversa não voltou para pending no Chatwoot", e),
    );
  await db
    .from("conversas")
    .update({ status: "pending", devolvida_para_alice_em: new Date().toISOString() })
    .eq("id", d.conversa.id);
  d.conversa.status = "pending";
}

async function primeiroNomeDoLead(db: Admin, empresaId: string, leadId: string | null) {
  if (!leadId) return null;
  const { data } = await db
    .from("crm_leads")
    .select("lead_name")
    .eq("id", leadId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  return primeiroNomeLimpo(data?.lead_name ?? null);
}

/** Conclui a repescagem ligada ao follow-up. */
async function concluirRepescagem(
  db: Admin,
  tarefa: Tarefa,
  resultado: string,
  cancelada: boolean,
  /** Canal do toque feito pela Alice (padrão: texto). */
  canal?: "audio",
) {
  const { data: f } = await db
    .from("crm_followups")
    .update({
      status: cancelada ? "Cancelada" : "Concluída",
      completed_at: new Date().toISOString(),
      result: resultado,
      ...(cancelada || resultado.startsWith("Modelo") || resultado.startsWith("sem desfecho")
        ? {}
        : { canal: canal ?? "texto" }),
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

/**
 * Conferência rápida antes de cada chamada ao modelo: mensagem do cliente mais nova que a última
 * lida, conversa fora da Alice (equipe assumiu) ou atendente escreveu desde o início. Devolve o
 * motivo ou null. A decisão final (descartar e reagendar) continua no fim da resposta.
 */
async function motivoParaParar(
  db: Admin,
  empresaId: string,
  conversaId: string,
  ultimaLida: Date | null,
  inicio: number,
): Promise<string | null> {
  const [{ data: ultima }, { data: conversa }, { data: humanas }] = await Promise.all([
    db
      .from("whatsapp_messages")
      .select("message_timestamp")
      .eq("empresa_id", empresaId)
      .eq("conversa_id", conversaId)
      .eq("direction", "Recebida")
      .eq("privada", false)
      .order("message_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("conversas").select("status").eq("id", conversaId).single(),
    db
      .from("whatsapp_messages")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("conversa_id", conversaId)
      .eq("direction", "Enviada")
      .eq("remetente_tipo", "user")
      .eq("privada", false)
      .gte("created_at", new Date(inicio).toISOString())
      .limit(1),
  ]);
  if (
    ultima &&
    (!ultimaLida || new Date(ultima.message_timestamp).getTime() > ultimaLida.getTime())
  )
    return "cliente mandou mensagem nova";
  if (humanas?.length) return "atendente escreveu";
  if (conversa && conversa.status !== "pending") return "equipe assumiu";
  return null;
}

// ---------------------------------------------------------------- conversa com a IA
async function conversar(
  db: Admin,
  tarefa: Tarefa,
  cfg: ConfigIa,
  d: DadosConversa,
  avisoFollowup: string | null,
  /** Instrução só desta resposta (ex.: confirmar o descadastro de marketing). */
  instrucaoExtra?: string,
  opcoes: { toqueAudio?: boolean } = {},
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

  // Franquia do plano (Profissional + Alice): conversa nova além das incluídas, teto em R$ ou
  // conversa cara vai para a equipe. Se a consulta falhar, a Alice segue (não trava o atendimento).
  const franquia = await conferirFranquia(db, tarefa.empresa_id, d.conversa.id);
  if (franquia) {
    if (ehFollowup) {
      await followupParaEquipe(db, tarefa, franquia);
      return { situacao: "ignorada", detalhe: `franquia: ${franquia}` };
    }
    await socorroHumano(db, tarefa, franquia);
    return { situacao: "concluida", detalhe: `franquia: ${franquia}` };
  }

  // O que ficou programado (orçamento depois do vídeo) sai antes da resposta nova.
  if (await descarregarProgramadas(db, tarefa.empresa_id, d)) {
    await new Promise((r) => setTimeout(r, ESPERA_WEBHOOK_MS));
  }

  const etapas = await etapasAbertas(db, tarefa.empresa_id);
  // Confirmação ou pós-venda da Alice esperando resposta nesta conversa.
  const { posPendente, instrucoesPos } = await import("./pos-resposta.server");
  const pos = ehFollowup ? null : await posPendente(db, tarefa.empresa_id, d.conversa);
  const ferramentas = ferramentasDisponiveis(cfg, etapas, {
    posAtendimento: Boolean(pos),
    regraNome: REGRA_NOME,
  });
  const [empresa, { lead, salesperson }, hist] = await Promise.all([
    contextoEmpresa(
      db,
      tarefa.empresa_id,
      cfg,
      ferramentas.map((f) => f.name),
    ),
    contextoLead(db, tarefa.empresa_id, d.conversa.crm_lead_id, Boolean(d.contato?.sem_pos_venda)),
    historico(
      db,
      tarefa.empresa_id,
      d.conversa.id,
      cfg.transcrever_audio,
      cacheDoHistorico(tarefa.empresa_id),
    ),
  ]);
  const turnos = montarTurnos(hist.mensagens, avisoFollowup ?? undefined);
  if (!turnos) return { situacao: "ignorada", detalhe: "nada novo do cliente para responder" };
  empresa.regraNome = REGRA_NOME;
  empresa.regraRespostas = REGRA_RESPOSTAS;
  empresa.regraPreco = REGRA_PRECO_DEPOIS;
  // Regra nº 1: sem pergunta da empresa respondida pelo cliente, nada de preço nesta resposta.
  const precoTravado = REGRA_PRECO_DEPOIS && !precoLiberado(hist.mensagens, hist.truncado);
  // Nome do cliente: confirmado (contato/conversa/cadastro) x nome do perfil.
  const nomeCliente = REGRA_NOME
    ? await (
        await import("./nome.server")
      ).situacaoDoNome(
        db,
        tarefa.empresa_id,
        d.conversa.id,
        d.conversa.whatsapp_contact_id,
        lead?.clienteId ?? null,
      )
    : null;
  if (lead && nomeCliente) lead.nomeCliente = nomeCliente;
  const nomeParaChamar = nomeCliente
    ? primeiroNomeLimpo(nomeCliente.confirmado)
    : (lead?.nome ?? null);

  const ctx: ContextoFerramenta = {
    toqueAudio: Boolean(opcoes.toqueAudio),
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
    notas: [],
    midias: new Set(),
    posAtendimento: pos,
    precoTravado,
    modulos: {
      disponiveis: empresa.modulos ?? [],
      carregados: chavesValidas(empresa.modulos ?? [], d.conversa.alice_modulos ?? []),
      aplicar: (t: string) => aplicarCamposDoRoteiro(t, empresa.empresa, empresa.camposRoteiro),
    },
  };
  const cliente = new Anthropic();
  // Cache: as instruções fixas têm um ponto de cache próprio; a conversa entra no cache
  // automático (top-level), que avança a cada rodada. A hora e os dados do lead mudam a cada
  // resposta, então ficam DEPOIS da conversa (mensagem de sistema no fim), para não quebrar o cache.
  const momento = [
    instrucoesDoMomento(new Date(), lead, lead ? null : nomeCliente),
    pos ? instrucoesPos(pos) : null,
    instrucaoExtra ?? null,
    precoTravado ? AVISO_PRECO_TRAVADO : null,
  ]
    .filter(Boolean)
    .join("\n");
  const momentoNoMeio = !SEM_SISTEMA_NO_MEIO.includes(cfg.modelo);
  const sistema: Anthropic.Beta.BetaTextBlockParam[] = [
    // Ferramentas + instruções fixas são iguais em todas as conversas da empresa: cache de 1 hora,
    // gravado uma vez e lido pelas próximas conversas (com 5 min, cada conversa regravava tudo).
    {
      type: "text",
      text: instrucoesFixas(empresa),
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
    // Módulos do roteiro já carregados nesta conversa: mudam pouco, cache próprio de 1 hora.
    ...(ctx.modulos!.carregados.length
      ? [
          {
            type: "text" as const,
            text: instrucoesDosModulos(empresa, ctx.modulos!.carregados),
            cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
          },
        ]
      : []),
    ...(momentoNoMeio ? [] : [{ type: "text" as const, text: momento }]),
  ];
  const uso: Uso = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, cacheEscrita1h: 0 };
  /** Mensagem nova do cliente ou equipe assumiu no meio da resposta: para antes de gastar mais. */
  let interrompida: string | null = null;
  const ferramentasUsadas: Array<{ nome: string; entrada: unknown; resultado: string }> = [];
  const saida: Saida[] = [];
  /** Relatório que a IA escreveu para si ("Enviei ao Breno...", "Ficha do cliente..."): não vai. */
  const retidos: string[] = [];
  /** Texto com preço antes do diagnóstico (regra nº 1): não vai. */
  const travados: string[] = [];
  let parada: string | null = null;
  let modeloUsado = cfg.modelo;
  let rodadas = 0;
  const historicoComCache = cacheDoHistorico(tarefa.empresa_id)
    ? marcarCacheDoHistorico(turnos)
    : turnos;
  const mensagens: Anthropic.Beta.BetaMessageParam[] = momentoNoMeio
    ? [...historicoComCache, { role: "system", content: momento }]
    : [...historicoComCache];

  while (rodadas < MAX_RODADAS) {
    // Antes de cada chamada (menos depois de criar/remarcar OS, que precisa da confirmação):
    // chegou mensagem nova ou a equipe assumiu? Para aqui; a tarefa seguinte responde tudo junto.
    if (!ctx.osAcao) {
      interrompida = await motivoParaParar(
        db,
        tarefa.empresa_id,
        d.conversa.id,
        hist.ultimaDoCliente,
        inicio,
      );
      if (interrompida) break;
    }
    rodadas++;
    const resposta = await chamarIa(() =>
      cliente.beta.messages.create({
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
      }),
    );
    // A conta da IA respondeu: se havia parada por crédito ou chave, fecha (uma vez por resposta).
    if (rodadas === 1) await encerrarParadas(db, "ia");
    modeloUsado = resposta.model;
    uso.entrada += resposta.usage.input_tokens;
    uso.saida += resposta.usage.output_tokens;
    uso.cacheLeitura += resposta.usage.cache_read_input_tokens ?? 0;
    uso.cacheEscrita += resposta.usage.cache_creation_input_tokens ?? 0;
    uso.cacheEscrita1h! += resposta.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    parada = resposta.stop_reason;
    if (resposta.stop_reason === "refusal") break;

    // O que a IA escreve vai ao cliente, na ordem (menos relatório interno); depois, o que as
    // ferramentas pediram (enviar_mensagem, vídeo, áudio), na ordem das chamadas.
    for (const b of resposta.content) {
      if (b.type !== "text" || !b.text.trim()) continue;
      if (textoInterno(b.text, nomeParaChamar)) retidos.push(b.text.trim());
      else if (precoTravado && temPreco(b.text)) travados.push(b.text.trim());
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
  if (
    ehFollowup &&
    !interrompida &&
    !ctx.passagem &&
    semNada.length === 0 &&
    parada !== "refusal"
  ) {
    await db.from("ia_execucoes").insert({ ...registro, mensagens_enviadas: [] });
    await concluirRepescagem(db, tarefa, `${cfg.nome} avaliou que não era preciso enviar`, true);
    return { situacao: "concluida", detalhe: "follow-up dispensado pela IA" };
  }
  if (
    !interrompida &&
    (parada === "refusal" || (!textos.length && !saida.length && !ctx.passagem))
  ) {
    // Áudio que não deu para transcrever: nunca em silêncio, vai o texto padrão.
    if (!ehFollowup && d.tokenRobo && ultimaEhAudioSemTranscricao(hist.mensagens)) {
      await enviarMensagem(
        d.conta,
        d.tokenRobo,
        d.conversa.chatwoot_conversation_id,
        TEXTO_AUDIO_SEM_TRANSCRICAO,
      );
      await db.from("ia_execucoes").insert({
        ...registro,
        erro: "sem resposta da IA: áudio sem transcrição, texto padrão enviado",
        mensagens_enviadas: [TEXTO_AUDIO_SEM_TRANSCRICAO] as never,
      });
      return { situacao: "concluida", detalhe: "áudio sem transcrição: texto padrão" };
    }
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

  // O que já mudou no sistema (ex.: remarcação) vai para a equipe de qualquer jeito.
  await enviarNotas(d, ctx, true);

  // Mensagem nova do cliente chegou enquanto a Alice pensava: a próxima tarefa responde tudo junto.
  const desde = new Date(inicio).toISOString();
  const [
    { data: outras },
    { data: agora },
    { data: passagem },
    { data: ultima },
    { data: humanas },
  ] = await Promise.all([
    db
      .from("ia_tarefas")
      .select("id")
      .eq("conversa_id", d.conversa.id)
      .eq("tipo", "responder")
      .in("situacao", ["pendente", "processando"])
      .neq("id", tarefa.id)
      .limit(1),
    db.from("conversas").select("status").eq("id", d.conversa.id).single(),
    db
      .from("ia_tarefas")
      .select("id, motivo")
      .eq("conversa_id", d.conversa.id)
      .eq("tipo", "passar_para_humano")
      .eq("situacao", "pendente")
      .maybeSingle(),
    db
      .from("whatsapp_messages")
      .select("message_timestamp")
      .eq("empresa_id", tarefa.empresa_id)
      .eq("conversa_id", d.conversa.id)
      .eq("direction", "Recebida")
      .eq("privada", false)
      .order("message_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("whatsapp_messages")
      .select("id")
      .eq("empresa_id", tarefa.empresa_id)
      .eq("conversa_id", d.conversa.id)
      .eq("direction", "Enviada")
      .eq("remetente_tipo", "user")
      .eq("privada", false)
      .gte("created_at", desde)
      .limit(1),
  ]);
  // Outra resposta da conversa na fila, ou mensagem do cliente mais nova que a última que a Alice
  // leu (nesse caso garante a tarefa que vai responder tudo junto).
  const mensagemNova = Boolean(
    ultima &&
    (!hist.ultimaDoCliente ||
      new Date(ultima.message_timestamp).getTime() > hist.ultimaDoCliente.getTime()),
  );
  const clienteEscreveu = Boolean(outras?.length) || mensagemNova;
  const humanoEscreveu =
    passagem?.motivo === "atendente humano assumiu" || Boolean(humanas?.length);
  const equipeAssumiu = agora?.status !== "pending" || Boolean(passagem);
  // OS criada/remarcada nesta resposta: a confirmação sai junto (a próxima resposta continua dali),
  // a não ser que alguém da equipe tenha escrito — aí só a equipe é avisada.
  const comOs = Boolean(ctx.osAcao) && !ctx.passagem;
  if (comOs && humanoEscreveu) {
    const os = ctx.osAcao!;
    await enviarNota(
      d,
      `🤖 OS ${os.os_number} ${os.tipo === "criada" ? "criada" : "remarcada"} pela ${cfg.nome} para ${os.quando} — o cliente NÃO recebeu a confirmação (a equipe assumiu a conversa enquanto ela respondia).`,
    );
    await db
      .from("ia_execucoes")
      .insert({ ...registro, erro: "descartada: humano assumiu (OS avisada à equipe)" });
    return { situacao: "ignorada", detalhe: "humano assumiu: OS avisada à equipe por nota" };
  }
  if (!comOs && clienteEscreveu) {
    if (!outras?.length && !equipeAssumiu) {
      await db.from("ia_tarefas").insert({
        empresa_id: tarefa.empresa_id,
        conversa_id: d.conversa.id,
        tipo: "responder",
        executar_apos: new Date(Date.now() + 3000).toISOString(),
        motivo: "mensagem nova durante a resposta",
      });
      const { enfileirarPendentes } = await import("./fila.server");
      await enfileirarPendentes(db);
    }
    await db
      .from("ia_execucoes")
      .insert({ ...registro, erro: "descartada: cliente mandou mensagem nova" });
    return {
      situacao: "ignorada",
      detalhe: "cliente mandou mensagem nova; resposta refeita na próxima tarefa",
    };
  }
  // Equipe assumiu enquanto a Alice pensava (a passagem ainda não mudou a situação no Chatwoot).
  if (!comOs && equipeAssumiu) {
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

  // Resposta em áudio (Configurações › Alice): o começo conversado pode sair falado.
  const audio = ctx.passagem
    ? null
    : await comAudio(
        db,
        tarefa.empresa_id,
        d,
        cfg,
        hist.mensagens,
        ehFollowup,
        agoraItens,
        Boolean(opcoes.toqueAudio),
      );
  const enviadas = [
    ...(audio?.enviadas ?? []),
    ...(await enviarItens(db, tarefa.empresa_id, d, audio?.itens ?? agoraItens)),
  ];
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
        i.tipo === "anexo" ? `[em ${espera}s] [mídia] ${i.nome}` : `[em ${espera}s] ${i.texto}`,
      ),
    );
  }
  await db.from("ia_execucoes").insert({
    ...registro,
    mensagens_enviadas: [
      ...enviadas,
      ...retidos.map((t) => `[não enviado: texto interno] ${t}`),
      ...travados.map((t) => `[não enviado: preço antes do diagnóstico] ${t}`),
    ],
  });
  await enviarNotas(d, ctx, false);
  // OS da equipe: a Alice tratou a resposta à mensagem dela e devolve a conversa para a equipe.
  if (ctx.devolverEquipe && !ctx.passagem && d.tokenRobo) {
    await enviarNota(d, ctx.devolverEquipe);
    await mudarSituacao(d.conta, d.tokenRobo, d.conversa.chatwoot_conversation_id, "open");
    await db.from("conversas").update({ status: "open" }).eq("id", d.conversa.id);
  }

  if (d.conversa.crm_lead_id) {
    await db
      .from("crm_leads")
      .update({ last_interaction_at: new Date().toISOString() })
      .eq("id", d.conversa.crm_lead_id)
      .eq("empresa_id", tarefa.empresa_id);
  }
  if (ehFollowup)
    await concluirRepescagem(
      db,
      tarefa,
      `Enviado pela ${cfg.nome}`,
      false,
      enviadas.some((e) => e.startsWith("[áudio]")) ? "audio" : undefined,
    );

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

  // Cadência do follow-up (C/D): respondeu e o cliente ainda não voltou → o sistema agenda o
  // próximo toque (toque da cadência feito agenda o seguinte). Toque curto ou trilha C agendados pela
  // Alice nesta resposta vêm primeiro; a cadência continua depois deles.
  if (!ctx.passagem && !ctx.osAcao && enviadas.length && !ctx.agendouToque) {
    const { seguirCadencia } = await import("./cadencia.server");
    const agendou = await seguirCadencia(db, {
      empresaId: tarefa.empresa_id,
      conversaId: d.conversa.id,
      leadId: d.conversa.crm_lead_id,
      cfg,
      atual: ehFollowup ? ((tarefa.dados ?? {}) as DadosCadencia) : null,
    }).catch((e) => {
      console.error("Alice: cadência não agendada", e instanceof Error ? e.message : e);
      return false;
    });
    if (agendou) ctx.agendouFollowup = true;
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
        conversa_id: d.conversa.id,
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
    await avisarPassagem(db, tarefa.empresa_id, d.conversa.id, motivo);
    return { situacao: "concluida", detalhe: `transferida para a equipe: ${motivo}` };
  }
  return { situacao: "concluida", detalhe: `${enviadas.length} mensagem(ns) enviada(s)` };
}

// ---------------------------------------------------------------- resposta em áudio
/**
 * Responder em áudio: o começo da resposta (textos simples, antes de qualquer bloco ou mídia) pode
 * sair falado, conforme as regras de voz.ts. Sem áudio (ou se ele falhar), devolve os itens como
 * estavam e o texto sai normal. "Manda por escrito" marca a conversa como só texto.
 */
async function comAudio(
  db: Admin,
  empresaId: string,
  d: DadosConversa,
  cfg: NonNullable<Awaited<ReturnType<typeof lerConfig>>>,
  mensagens: MensagemHistorico[],
  ehFollowup: boolean,
  itens: Saida[],
  /** Toque do dia seguinte em áudio: o único follow-up que pode sair falado. */
  toqueAudio = false,
): Promise<{ itens: Saida[]; enviadas: string[] } | null> {
  if (!cfg.audio_ativo || (ehFollowup && !toqueAudio) || !d.tokenRobo) return null;
  const ultima = mensagens.filter((m) => m.direcao === "Recebida").at(-1);
  let soTexto = Boolean(d.conversa.alice_so_texto_em);
  const { pediuPorEscrito, diaBrasilia, inicioDoDiaBrasilia } = await import("./voz");
  if (!soTexto && ultima && pediuPorEscrito(`${ultima.texto ?? ""} ${ultima.transcricao ?? ""}`)) {
    soTexto = true;
    await db
      .from("conversas")
      .update({ alice_so_texto_em: new Date().toISOString() })
      .eq("id", d.conversa.id)
      .eq("empresa_id", empresaId);
    await enviarNota(
      d,
      `🔇 O cliente pediu por escrito: a ${cfg.nome} não manda mais áudio nesta conversa.`,
    );
  }

  // Explicação em áudio (falar_em_audio): o que vem antes sai primeiro, na ordem; depois o áudio.
  const iFala = itens.findIndex((i) => i.tipo === "fala");
  let explicacao: string | undefined;
  let antes: string[] = [];
  let n = 0;
  let resposta = "";
  if (iFala >= 0) {
    antes = await enviarItens(db, empresaId, d, itens.slice(0, iFala));
    explicacao = (itens[iFala] as { texto: string }).texto;
    n = iFala + 1;
  } else {
    while (n < itens.length) {
      const i = itens[n]!;
      if (i.tipo !== "texto" || i.bloco) break;
      n++;
    }
    if (!n) return null;
    resposta = itens
      .slice(0, n)
      .map((i) => (i.tipo === "texto" ? i.texto : ""))
      .join("\n\n");
  }

  const { responderComAudio } = await import("./resposta-audio");
  const { sintetizar } = await import("./voz.server");
  const { duracaoOggOpus } = await import("./ogg-opus");
  const conversa = d.conversa.chatwoot_conversation_id;
  const eleven = cfg.audio_provedor === "elevenlabs";
  const { data: precoEleven } = eleven
    ? await db
        .from("configuracoes_plataforma")
        .select("valor")
        .eq("chave", "elevenlabs_usd_por_mil_creditos")
        .maybeSingle()
    : { data: null };
  const r = await responderComAudio(
    {
      cfg: {
        audio_ativo: cfg.audio_ativo,
        audio_voz: cfg.audio_voz,
        audio_max_caracteres: cfg.audio_max_caracteres,
        audio_max_segundos: cfg.audio_max_segundos,
        audio_limite_diario_reais: Number(cfg.audio_limite_diario_reais),
        audio_cotacao_dolar: Number(cfg.audio_cotacao_dolar),
        audio_provedor: eleven ? "elevenlabs" : "google",
        audio_eleven_voz: cfg.audio_eleven_voz,
        audio_eleven_modelo: cfg.audio_eleven_modelo,
        eleven_usd_por_mil_creditos: Number(precoEleven?.valor) || USD_POR_MIL_CREDITOS_PADRAO,
        audio_limite_diario_creditos: cfg.audio_limite_diario_creditos ?? null,
      },
      ultimaDoClienteEhAudio: ultima?.tipo === "Áudio",
      soTexto,
      ehFollowup,
      toqueAudio,
      resposta,
      explicacao,
    },
    {
      gastoHoje: async () => {
        const { data } = await db
          .from("ia_audios_uso")
          .select("custo_reais")
          .eq("empresa_id", empresaId)
          .gte("created_at", inicioDoDiaBrasilia());
        return (data ?? []).reduce((s, u) => s + Number(u.custo_reais ?? 0), 0);
      },
      sintetizar,
      // ElevenLabs devolve MP3: vira OGG/Opus já aqui, para medir a duração (o envio recodifica
      // de novo como o gravador do Chatwoot, igual ao áudio do Google).
      sintetizarEleven: async (texto, voz, modelo) => {
        const { sintetizarEleven } = await import("./eleven.server");
        const r = await sintetizarEleven(texto, voz, modelo);
        // Alarme de crédito da voz: sem crédito ou chave recusada abre a parada; deu certo, fecha.
        if ("erro" in r) {
          const causa = causaDaParadaVoz(r.erro);
          if (causa) await registrarParada(db, empresaId, "voz", causa, null);
          return r;
        }
        await encerrarParadas(db, "voz");
        try {
          const { paraOggOpus } = await import("@/lib/audio-voz.server");
          return { bytes: await paraOggOpus(r.bytes) };
        } catch (e) {
          return {
            erro: `conversão do áudio da ElevenLabs: ${e instanceof Error ? e.message : e}`,
          };
        }
      },
      duracao: duracaoOggOpus,
      // Mesmo caminho da barra de resposta: recodifica como o gravador do Chatwoot (toca como
      // voz no iPhone) e manda com a marcação de voz.
      enviarAudio: async (bytes) => {
        const { MARCAR_COMO_VOZ, paraOggOpus } = await import("@/lib/audio-voz.server");
        const voz = await paraOggOpus(bytes);
        return enviarAnexo(
          d.conta,
          d.tokenRobo!,
          conversa,
          new Blob([new Uint8Array(voz)], { type: "audio/ogg" }),
          "audio.ogg",
          "",
          MARCAR_COMO_VOZ,
        );
      },
      enviarNota: (texto) => enviarNota(d, texto),
      registrar: async (u) => {
        const { error } = await db.from("ia_audios_uso").insert({
          empresa_id: empresaId,
          conversa_id: d.conversa.id,
          chatwoot_message_id: u.chatwootMessageId,
          voz: u.voz,
          provedor: u.provedor,
          modelo: u.modelo,
          aviso: u.aviso,
          situacao: u.situacao,
          caracteres: u.caracteres,
          segundos: u.segundos,
          custo_reais: u.custo,
          creditos: u.creditos,
          texto_falado: u.texto,
          erro: u.erro,
        });
        if (error) throw new Error(error.message);
      },
      creditosHoje: async () => {
        const { data } = await db
          .from("ia_audios_uso")
          .select("creditos")
          .eq("empresa_id", empresaId)
          .gte("created_at", inicioDoDiaBrasilia());
        return (data ?? []).reduce((s, u) => s + Number(u.creditos ?? 0), 0);
      },
      avisar80: async () => {
        await db.from("mkt_avisos").insert({
          empresa_id: empresaId,
          tipo: "alice_audio_80",
          titulo: `${cfg.nome}: 80% do teto de áudio de hoje`,
          mensagem: `A ${cfg.nome} já usou 80% dos ${Number(cfg.audio_limite_diario_creditos).toLocaleString("pt-BR")} créditos de áudio de hoje. Ao chegar no teto, ela responde só em texto até amanhã.`,
          so_no_app: true,
          referencia: `alice-audio-80:${diaBrasilia()}`,
        } as never);
      },
      avisarLimite: async () => {
        const limite = cfg.audio_limite_diario_creditos
          ? `${Number(cfg.audio_limite_diario_creditos).toLocaleString("pt-BR")} créditos (ou ${Number(cfg.audio_limite_diario_reais).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})`
          : Number(cfg.audio_limite_diario_reais).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            });
        // Um aviso por dia, só no app (a referência repetida é recusada pelo índice único).
        await db.from("mkt_avisos").insert({
          empresa_id: empresaId,
          tipo: "alice_audio_limite",
          titulo: `${cfg.nome}: limite diário de áudio`,
          mensagem: `A ${cfg.nome} chegou ao limite de ${limite} em áudios hoje e voltou a responder só em texto até amanhã. O limite fica em Configurações › Alice › Responder em áudio.`,
          so_no_app: true,
          referencia: `alice-audio-limite:${diaBrasilia()}`,
        } as never);
      },
    },
  );
  // Nunca dois áudios seguidos: outra fala no resto da resposta sai em texto.
  const semFala = (l: Saida[]): Saida[] =>
    l.map((i) => (i.tipo === "fala" ? { tipo: "texto", texto: i.texto, bloco: true } : i));
  if (!r.enviado)
    return explicacao !== undefined
      ? {
          itens: semFala([{ tipo: "fala", texto: explicacao }, ...itens.slice(n)]),
          enviadas: antes,
        }
      : null;
  const resto: Saida[] = r.texto ? [{ tipo: "texto", texto: r.texto }] : [];
  const fala = r.decisao.modo === "audio" ? r.decisao.fala : "";
  return { itens: semFala([...resto, ...itens.slice(n)]), enviadas: [...antes, `[áudio] ${fala}`] };
}

// ---------------------------------------------------------------- envio
/** Nota privada no Chatwoot (só a equipe vê). */
async function enviarNota(d: DadosConversa, texto: string) {
  if (!d.tokenRobo) return;
  await enviarMensagem(
    d.conta,
    d.tokenRobo,
    d.conversa.chatwoot_conversation_id,
    texto,
    true,
  ).catch((e) => console.error("Alice: nota para a equipe não enviada", e));
}

/** Notas das ferramentas (avisar_equipe, remarcação): sempre=true sai mesmo sem resposta. */
async function enviarNotas(d: DadosConversa, ctx: ContextoFerramenta, sempre: boolean) {
  for (const n of ctx.notas ?? []) if (n.sempre === sempre) await enviarNota(d, n.texto);
}

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
    if (item.tipo === "texto" || item.tipo === "fala") {
      // Fala sem áudio (desligado, só texto ou falha): o texto escrito para falar sai inteiro.
      const partes =
        item.tipo === "fala" || item.bloco
          ? [limparTexto(item.texto)]
          : dividirResposta(item.texto);
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
