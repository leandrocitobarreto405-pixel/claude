/**
 * Tatiana (gerente comercial), fase 2: a passada da noite. A varredura do servidor (a cada 5–10 min)
 * chama rodarTatiana(): a partir da hora da noite da empresa (21h30), monta a lista de leads da
 * noite e decide lead a lead (uma ação, a caixinha e os "acertos no app"), em rodadas curtas até
 * terminar; depois escreve o recado do dia de cada pessoa. De manhã, push para quem tem tarefa; às
 * 21h45, push das cobranças para o admin. Modo "teste": as tarefas da equipe aparecem (são só
 * sugestões) e as da Alice só ficam registradas ("padrão faria × Tatiana decidiu"). Modo
 * "conferencia": só conta os acertos, sem criar nada visível. Nada é enviado a clientes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularFatos, conversaEmTexto, quemMandou } from "./fatos";
import {
  adiarTarefa,
  bloqueadaParaVenda,
  diaDeRever,
  CAIXINHAS_FINALIZADAS,
  MOTIVO_LACUNA,
  MOTIVO_OFERTA,
  campanhaSemResposta,
  finalizadoFora,
  frioAindaRecente,
  guardadoFora,
  temLacuna,
  temOfertaDeCondicao,
  followUpEsquecido,
  horarioDaConfig,
  motivosDeEntrada,
  proximoHorarioUtil,
  reverEmIso,
  textoFollowUpEsquecido,
  textoPosVenda,
  textoRemarcar,
  type HorarioUtil,
  type MotivoEntrada,
} from "./furos";
import { primeiroNomeLimpo } from "@/lib/alice/nome";
import { dataCurta, diaSemanaDe } from "@/lib/feriados";
import { avaliarVirarOs, planejarAcoes, textoFeitoPelaTatiana } from "./acoes";
import {
  MODELO_FICHA,
  MODELO_HAIKU,
  MODELO_OPUS,
  PRECO_HAIKU,
  PRECO_OPUS,
  custoUsd,
} from "./ficha";
import {
  ESQUEMA_DECISAO,
  confereDesfecho,
  ESQUEMA_RECADO,
  NOME_GERENTE,
  aplicarTravas,
  cobrancasVisiveis,
  demorasDaEquipe,
  desdeAUltimaPassada,
  finalDoTelefone,
  fraseReserva,
  nomeDaPessoa,
  nomesDaEquipe,
  instrucoesDecisao,
  instrucoesRecado,
  padraoFaria,
  quandoParaIso,
  resolvidaPeloApp,
  textoPushCobrancas,
  textoPushTarefas,
  type DecisaoIA,
  type EstadoApp,
  type TipoCobranca,
  saneaAcertos,
} from "./tatiana";

type Db = SupabaseClient;
const TZ = "America/Sao_Paulo";
/** Leads por rodada (em paralelo) e tempo máximo de uma passada. */
const POR_RODADA = 5;
const TEMPO_DA_PASSADA_MS = 100_000;
/** Outra passada só assume a noite se a anterior parou de atualizar há mais que isto. */
const TRAVA_MS = 4 * 60_000;
/** Conversa enviada à IA: só o fim (as decisões olham o que é recente). */
const MAX_CONVERSA = 24_000;

function horarioSP(agora: Date) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { data: `${v("year")}-${v("month")}-${v("day")}`, hora: `${v("hour")}:${v("minute")}` };
}
const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Config = {
  empresa_id: string;
  modo: "desligado" | "teste" | "ativo";
  /** Equipe única: tarefas, acertos e recado são da equipe (sem separar por pessoa). */
  equipe_unica?: boolean;
  teto_mensal_usd: number | string;
  hora_noite: string;
  alerta_teto_mes: string | null;
  /** Horário de atendimento (tarefas só em dia/hora útil). */
  dias_uteis?: number[] | null;
  hora_inicio?: string | null;
  hora_fim?: string | null;
  /** Mais recurso (03/11): "claude-opus-5-5" liga a leitura completa no Opus. */
  modelo?: string | null;
};

/** Leitura completa no Opus (mais recurso, item 1): todo lead sem desfecho, toda noite. */
export const usaLeituraCompleta = (modelo: string | null | undefined) =>
  Boolean(modelo && modelo.startsWith("claude-opus"));
/** Acima disso, o push da manhã avisa que a lista está grande (03/11). */
const LISTA_GRANDE = 30;

/** O que a noite guarda no resumo sobre quem entrou e por quê (furos, 01/11). */
type EspeciaisDaNoite = {
  /** Lead → data do toque vencido que ninguém fez (tarefa "follow-up esquecido"). */
  esquecidos: Record<string, string>;
};
type Noite = {
  id: string;
  empresa_id: string;
  noite: string;
  modo: "teste" | "ativo" | "conferencia";
  leads: string[];
  processados: number;
  com_erro: number;
  status: string;
  custo_usd: number | string;
  resumo: Record<string, unknown>;
  atualizada_em: string | null;
};

// ---------------------------------------------------------------- pessoas da empresa

type PessoaEquipe = {
  userId: string;
  /** Primeiro nome do cadastro ("" sem nome: o recado sai sem nome, nunca com o e-mail). */
  nome: string;
  papel: string;
  /** Agente do Chatwoot ligado à pessoa (Equipe), para achar o dono da conversa. */
  chatwootAgentId: number | null;
};

export async function pessoasDaEmpresa(db: Db, empresaId: string): Promise<PessoaEquipe[]> {
  const { data } = await db
    .from("usuarios_empresa")
    .select("user_id, papel, chatwoot_agent_id")
    .eq("empresa_id", empresaId)
    .in("papel", ["admin", "atendente"]);
  const saida: PessoaEquipe[] = [];
  for (const u of (data ?? []) as Array<{
    user_id: string;
    papel: string;
    chatwoot_agent_id: number | null;
  }>) {
    const { data: r } = await db.auth.admin.getUserById(u.user_id);
    const meta = (r?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const cadastro =
      (meta["full_name"] as string | undefined) || (meta["name"] as string | undefined) || "";
    saida.push({
      userId: u.user_id,
      nome: nomeDaPessoa(cadastro, r?.user?.email),
      papel: u.papel,
      chatwootAgentId: u.chatwoot_agent_id === null ? null : Number(u.chatwoot_agent_id),
    });
  }
  return saida;
}

/**
 * Quem cuida do lead: quem assumiu a conversa pelo app; senão quem mandou a última mensagem pelo
 * Nexa; senão o responsável do Chatwoot (pelo agente ligado à pessoa em Equipe; sem isso, pelo
 * primeiro nome); senão ninguém (o admin vê). Mensagem sem remetente conta para quem é
 * responsável pela conversa.
 */
async function donoDoLead(
  db: Db,
  empresaId: string,
  leadId: string,
  pessoas: PessoaEquipe[],
): Promise<string | null> {
  const { data: convs } = await db
    .from("conversas")
    .select("id, assumida_por, responsavel_id, responsavel_nome, ultima_atividade_em")
    .eq("empresa_id", empresaId)
    .eq("crm_lead_id", leadId)
    .order("ultima_atividade_em", { ascending: false, nullsFirst: false })
    .limit(3);
  const lista = (convs ?? []) as Array<{
    id: string;
    assumida_por: string | null;
    responsavel_id: number | null;
    responsavel_nome: string | null;
  }>;
  const assumida = lista.find((c) => c.assumida_por)?.assumida_por;
  if (assumida) return assumida;
  if (lista.length) {
    const { data: ult } = await db
      .from("whatsapp_messages")
      .select("enviada_por")
      .eq("empresa_id", empresaId)
      .in(
        "conversa_id",
        lista.map((c) => c.id),
      )
      .not("enviada_por", "is", null)
      .order("message_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    const por = (ult as { enviada_por?: string } | null)?.enviada_por;
    if (por) return por;
  }
  const agente = lista.find((c) => c.responsavel_id !== null)?.responsavel_id;
  if (agente !== undefined && agente !== null) {
    const dono = pessoas.find((p) => p.chatwootAgentId === Number(agente));
    if (dono) return dono.userId;
  }
  const nomeResp = lista
    .find((c) => c.responsavel_nome)
    ?.responsavel_nome?.toLowerCase()
    .trim();
  if (nomeResp) {
    const achou = pessoas.find((p) => {
      const n = p.nome.toLowerCase().trim();
      return n && (n === nomeResp || nomeResp.split(" ")[0] === n);
    });
    if (achou) return achou.userId;
  }
  return null;
}

// ---------------------------------------------------------------- escopo da noite

export type EscopoDaNoite = {
  ids: string[];
  /** Quantos entraram por motivo (um lead pode ter mais de um; resposta a campanha é parte de "mensagem"). */
  entrada: Record<
    | MotivoEntrada
    | "esquecido"
    | "resposta_campanha"
    | "completa"
    | "campanha_sem_resposta"
    | "finalizado"
    | "guardado"
    | "frio_adiado",
    number
  >;
  especiais: EspeciaisDaNoite;
};

/**
 * Quem entra na noite (01/11): (a) qualquer mensagem não privada desde a última passada, de
 * qualquer lado (os disparos de campanha não contam); (b) próxima olhada (rever_em) chegou;
 * (c) rede de segurança: aberto nas caixinhas 2–5 sem toque futuro e sem próxima olhada; se havia
 * toque vencido que ninguém fez, vira "follow-up esquecido". Lead fechado/perdido só por mensagem.
 * Lead criado por campanha/disparo que nunca respondeu não entra (04/11): fica nas listas de campanha.
 */
async function escopoDaNoite(
  db: Db,
  empresaId: string,
  agora: Date,
  hoje: string,
  completo = false,
): Promise<EscopoDaNoite> {
  const { data: anterior } = await db
    .from("comercial_noites")
    .select("iniciada_em")
    .eq("empresa_id", empresaId)
    .neq("modo", "conferencia")
    .order("iniciada_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const desde = desdeAUltimaPassada(
    (anterior as { iniciada_em?: string } | null)?.iniciada_em ?? null,
    agora,
  );
  const fimDeHoje = new Date(`${hoje}T23:59:59-03:00`).toISOString();
  const [
    { data: msgs },
    { data: disparos },
    { data: pendentes },
    { data: fichas },
    { data: respostas },
  ] = await Promise.all([
    db
      .from("whatsapp_messages")
      .select("crm_lead_id, chatwoot_message_id")
      .eq("empresa_id", empresaId)
      .eq("privada", false)
      .not("crm_lead_id", "is", null)
      .gte("message_timestamp", desde)
      .limit(8000),
    db
      .from("mkt_envios")
      .select("chatwoot_message_id")
      .eq("empresa_id", empresaId)
      .gte("enviado_em", desde)
      .not("chatwoot_message_id", "is", null)
      .limit(5000),
    db
      .from("crm_followups")
      .select("crm_lead_id, scheduled_at, origem, status")
      .eq("empresa_id", empresaId)
      .eq("status", "Pendente")
      .limit(5000),
    db
      .from("comercial_analises")
      .select("crm_lead_id, caixinha, caixinha_em, rever_em, etiquetas")
      .eq("empresa_id", empresaId)
      .limit(5000),
    // Resposta do cliente a uma campanha conta sempre (e é contada à parte).
    db
      .from("mkt_envios")
      .select("normalized_phone")
      .eq("empresa_id", empresaId)
      .gte("respondido_em", desde)
      .limit(5000),
  ]);
  const respondeuCampanha = new Set(
    ((respostas ?? []) as Array<{ normalized_phone: string }>).map((r) =>
      finalDoTelefone(r.normalized_phone),
    ),
  );
  const deCampanha = new Set(
    ((disparos ?? []) as Array<{ chatwoot_message_id: number | string }>).map((d) =>
      String(d.chatwoot_message_id),
    ),
  );
  const mensagem = new Set<string>();
  for (const m of (msgs ?? []) as Array<{
    crm_lead_id: string;
    chatwoot_message_id: number | string | null;
  }>)
    if (m.chatwoot_message_id == null || !deCampanha.has(String(m.chatwoot_message_id)))
      mensagem.add(m.crm_lead_id);
  const toqueFuturo = new Set<string>();
  const vencidos = new Map<string, Array<{ scheduledAt: string; status: string }>>();
  for (const t of (pendentes ?? []) as Array<{
    crm_lead_id: string | null;
    scheduled_at: string;
    origem: string | null;
    status: string;
  }>) {
    if (!t.crm_lead_id) continue;
    if (t.scheduled_at >= agora.toISOString()) toqueFuturo.add(t.crm_lead_id);
    // Tarefa da própria Tatiana vencida é "pendente de ontem", não follow-up esquecido.
    else if (t.origem !== "gerente")
      vencidos.set(t.crm_lead_id, [
        ...(vencidos.get(t.crm_lead_id) ?? []),
        { scheduledAt: t.scheduled_at, status: t.status },
      ]);
  }
  const ficha = new Map(
    (
      (fichas ?? []) as Array<{
        crm_lead_id: string;
        caixinha: number | null;
        caixinha_em: string | null;
        rever_em: string | null;
        etiquetas: { guardado_em?: string | null } | null;
      }>
    ).map((f) => [f.crm_lead_id, f]),
  );
  const candidatos = new Set<string>([...mensagem, ...vencidos.keys()]);
  for (const [id, f] of ficha) {
    if (f.rever_em && f.rever_em <= fimDeHoje) candidatos.add(id);
    if (
      !f.rever_em &&
      f.caixinha !== null &&
      f.caixinha >= 2 &&
      f.caixinha <= 5 &&
      !toqueFuturo.has(id)
    )
      candidatos.add(id);
  }
  // Leitura completa (mais recurso, 03/11): todo lead aberto sem desfecho entra, sem limite.
  const semDesfecho = new Set<string>();
  let frioAdiado = 0;
  if (completo) {
    for (let de = 0; ; de += 1000) {
      const { data: abertos } = await db
        .from("crm_leads")
        .select("id")
        .eq("empresa_id", empresaId)
        .eq("is_open", true)
        .is("perdido_em", null)
        .range(de, de + 999);
      const lista = (abertos ?? []) as Array<{ id: string }>;
      for (const l of lista) {
        const cx = ficha.get(l.id)?.caixinha ?? null;
        if (cx !== null && CAIXINHAS_FINALIZADAS.has(cx)) continue;
        // Frio sem novidade: só a cada 3 dias (quem tem novidade já entrou por outro motivo).
        if (
          !candidatos.has(l.id) &&
          frioAindaRecente(cx, ficha.get(l.id)?.caixinha_em ?? null, agora)
        ) {
          frioAdiado++;
          continue;
        }
        semDesfecho.add(l.id);
        candidatos.add(l.id);
      }
      if (lista.length < 1000) break;
    }
  }
  const ids = [...candidatos];
  const saida: EscopoDaNoite = {
    ids: [],
    entrada: {
      mensagem: 0,
      resposta_campanha: 0,
      rever: 0,
      seguranca: 0,
      esquecido: 0,
      completa: 0,
      campanha_sem_resposta: 0,
      finalizado: 0,
      guardado: 0,
      frio_adiado: 0,
    },
    especiais: { esquecidos: {} },
  };
  for (let i = 0; i < ids.length; i += 200) {
    const parte = ids.slice(i, i + 200);
    const { data: leads } = await db
      .from("crm_leads")
      .select(
        "id, is_open, perdido_em, linked_work_order_id, normalized_phone, entrada, respondeu_em",
      )
      .eq("empresa_id", empresaId)
      .in("id", parte);
    const lote = (leads ?? []) as Array<{
      id: string;
      is_open: boolean | null;
      perdido_em: string | null;
      linked_work_order_id: string | null;
      normalized_phone: string | null;
      entrada: string | null;
      respondeu_em: string | null;
    }>;
    // Criado por campanha/disparo e nunca respondeu (04/11): fica nas listas de campanha.
    const semResposta = lote
      .filter((l) => l.entrada === "ativo" && !l.respondeu_em && l.normalized_phone)
      .map((l) => l.normalized_phone as string);
    const comDisparo = new Set<string>();
    if (semResposta.length) {
      const { data: envs } = await db
        .from("mkt_envios")
        .select("normalized_phone")
        .eq("empresa_id", empresaId)
        .not("enviado_em", "is", null)
        .in("normalized_phone", semResposta);
      for (const e of (envs ?? []) as Array<{ normalized_phone: string }>)
        comDisparo.add(e.normalized_phone);
    }
    // Guardado para campanha (04/11): volta só se o cliente falou depois de guardado.
    const guardados = lote
      .map((l) => ({ id: l.id, em: ficha.get(l.id)?.etiquetas?.guardado_em ?? null }))
      .filter((g): g is { id: string; em: string } => Boolean(g.em));
    const falouDepois = new Set<string>();
    if (guardados.length) {
      const desdeG = guardados.map((g) => g.em).sort()[0] as string;
      const { data: resp } = await db
        .from("whatsapp_messages")
        .select("crm_lead_id, message_timestamp")
        .eq("empresa_id", empresaId)
        .eq("direction", "Recebida")
        .in(
          "crm_lead_id",
          guardados.map((g) => g.id),
        )
        .gt("message_timestamp", desdeG)
        .limit(2000);
      const em = new Map(guardados.map((g) => [g.id, g.em]));
      for (const r of (resp ?? []) as Array<{ crm_lead_id: string; message_timestamp: string }>)
        if (r.message_timestamp > (em.get(r.crm_lead_id) ?? "")) falouDepois.add(r.crm_lead_id);
    }
    for (const l of lote) {
      if (
        finalizadoFora({
          caixinha: ficha.get(l.id)?.caixinha ?? null,
          temOs: Boolean(l.linked_work_order_id),
          mensagemNoDia: mensagem.has(l.id),
        })
      ) {
        saida.entrada.finalizado++;
        continue;
      }
      if (
        guardadoFora({
          guardadoEm: ficha.get(l.id)?.etiquetas?.guardado_em ?? null,
          clienteFalouDepois: falouDepois.has(l.id),
        })
      ) {
        saida.entrada.guardado++;
        continue;
      }
      if (
        campanhaSemResposta({
          entrada: l.entrada,
          respondeuEm: l.respondeu_em,
          recebeuDisparo: Boolean(l.normalized_phone && comDisparo.has(l.normalized_phone)),
        })
      ) {
        saida.entrada.campanha_sem_resposta++;
        continue;
      }
      const f = ficha.get(l.id);
      const motivos = motivosDeEntrada({
        // Lead com OS também entra (acertos de visita e pagamento), se tiver novidade.
        aberto: l.is_open !== false || Boolean(l.linked_work_order_id),
        perdido: Boolean(l.perdido_em),
        mensagemNoDia: mensagem.has(l.id),
        reverEm: f?.rever_em ?? null,
        caixinha: f?.caixinha ?? null,
        toqueFuturo: toqueFuturo.has(l.id),
        hoje,
      });
      const esquecido =
        !l.perdido_em && l.is_open !== false
          ? followUpEsquecido(vencidos.get(l.id) ?? [], agora)
          : null;
      if (!motivos.length && !esquecido) {
        if (!semDesfecho.has(l.id)) continue;
        saida.entrada.completa++;
      }
      saida.ids.push(l.id);
      for (const m of motivos) saida.entrada[m]++;
      if (
        motivos.includes("mensagem") &&
        respondeuCampanha.has(finalDoTelefone(l.normalized_phone))
      )
        saida.entrada.resposta_campanha++;
      if (esquecido) {
        saida.entrada.esquecido++;
        saida.especiais.esquecidos[l.id] = esquecido;
      }
    }
  }
  saida.entrada.frio_adiado = frioAdiado;
  return saida;
}

// ---------------------------------------------------------------- estado do lead no app

type EstadoLead = {
  texto: string;
  estado: EstadoApp;
  temOs: boolean;
  /** OS ligada ao lead (id e número) para as ações da Tatiana (03/11). */
  osId: string | null;
  osNumero: string | null;
  clienteId: string | null;
  /** Campos do cadastro do cliente (null = vazio); sem cadastro: null. */
  cliente: Record<"nome" | "cpf" | "endereco" | "email" | "cep", string | null> | null;
  /** Há orçamento no app (do lead ou solto do mesmo telefone). */
  temOrcamento: boolean;
  /** Orçamentos abertos do lead, o mais novo primeiro (B7). */
  orcamentosAbertos: Array<{
    numero: number | null;
    distanciaKm: number | null;
    foraDaArea: boolean;
  }>;
  aberto: boolean;
  anuncio: boolean;
  conversaId: string | null;
  pendente: { id: string; etapa: string | null; quando: string; responsavel: string } | null;
  /** Travas da tarefa (31/10). */
  travas: { retornoCombinado: boolean; toqueMarcado: boolean; campanha30Dias: boolean };
  /** OS com visita marcada e o cliente sem endereço ou CEP (única cobrança de cadastro que vale). */
  osSemEndereco: boolean;
  /** Última mensagem do cliente (acertos só de conversa dos últimos 7 dias). */
  ultimaDoCliente: string | null;
  /** Nunca tarefa, toque nem campanha (opt-out, IA desligada, sem pós-venda, descartado). */
  bloqueado: string | null;
  /** Caixinha atual da ficha (antes da decisão desta noite). */
  caixinha: number | null;
  comOrcamento: boolean;
  telefone: string | null;
  nome: string;
};

async function estadoDoLead(db: Db, empresaId: string, leadId: string): Promise<EstadoLead> {
  const { data: l } = await db
    .from("crm_leads")
    .select(
      "id, lead_name, phone, normalized_phone, is_open, perdido_em, customer_id, linked_work_order_id, gclid, gbraid, lp_origem, source_type, orcamento_enviado_em, orcamento_origem, retorno_combinado_em",
    )
    .eq("id", leadId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const lead = (l ?? {}) as Record<string, string | boolean | null>;
  const os = lead["linked_work_order_id"] as string | null;
  // Cliente: o do lead ou, sem ele, o da OS (o cadastro nasce do orçamento ao virar OS).
  const { data: woRow } = os
    ? await db
        .from("work_orders")
        .select("customer_id, os_number, negotiated_payment_method")
        .eq("id", os)
        .eq("empresa_id", empresaId)
        .maybeSingle()
    : { data: null };
  const wo = woRow as {
    customer_id?: string | null;
    os_number?: string | number | null;
    negotiated_payment_method?: string | null;
  } | null;
  const clienteId = (lead["customer_id"] as string | null) ?? wo?.customer_id ?? null;
  const fim = finalDoTelefone(
    (lead["normalized_phone"] as string | null) ?? (lead["phone"] as string | null),
  );
  const [
    { data: quotes },
    { data: visitas },
    { data: pags },
    { data: cli },
    { data: fus },
    { data: conv },
    { data: soltos },
    { data: envios },
    { data: ultimaCli },
  ] = await Promise.all([
    db
      .from("quotes")
      .select("numero, status, total, created_at, distancia_km, fora_da_area")
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", leadId)
      .order("created_at"),
    os
      ? db
          .from("visits")
          .select("scheduled_date, scheduled_time, status, updated_at")
          .eq("empresa_id", empresaId)
          .eq("work_order_id", os)
      : Promise.resolve({ data: [] }),
    os
      ? db
          .from("payments")
          .select("payment_status, gross_amount")
          .eq("empresa_id", empresaId)
          .eq("work_order_id", os)
          .eq("is_active", true)
      : Promise.resolve({ data: [] }),
    clienteId
      ? db
          .from("customers")
          .select("full_name, document_number, email, full_address, postal_code")
          .eq("id", clienteId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from("crm_followups")
      .select("id, etapa, scheduled_at, responsavel, trilha, origem")
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", leadId)
      .eq("status", "Pendente")
      .order("scheduled_at")
      .limit(10),
    db
      .from("conversas")
      .select("id, whatsapp_contact_id")
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", leadId)
      .order("ultima_atividade_em", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    // Orçamento solto do mesmo telefone (sem lead), dos últimos 30 dias.
    fim.length === 8
      ? db
          .from("quotes")
          .select("cliente_telefone, created_at")
          .eq("empresa_id", empresaId)
          .is("crm_lead_id", null)
          .ilike("cliente_telefone", `%${fim.slice(-4)}%`)
          .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
          .limit(20)
      : Promise.resolve({ data: [] }),
    // Campanha ou promoção recebida nos últimos 30 dias (trava da tarefa).
    fim.length === 8
      ? db
          .from("mkt_envios")
          .select("normalized_phone, respondido_em")
          .eq("empresa_id", empresaId)
          .eq("status", "enviado")
          .like("normalized_phone", `%${fim}`)
          .gte("enviado_em", new Date(Date.now() - 30 * 86_400_000).toISOString())
          .limit(5)
      : Promise.resolve({ data: [] }),
    db
      .from("whatsapp_messages")
      .select("message_timestamp")
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", leadId)
      .eq("direction", "Recebida")
      .eq("privada", false)
      .order("message_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const orcSoltos = (
    (soltos ?? []) as Array<{ cliente_telefone: string | null; created_at: string }>
  ).filter((q) => finalDoTelefone(q.cliente_telefone) === fim);
  const convRow = conv as { id?: string; whatsapp_contact_id?: string | null } | null;
  const [{ data: contato }, { data: fichaAtual }] = await Promise.all([
    convRow?.whatsapp_contact_id
      ? db
          .from("whatsapp_contacts")
          .select("ia_desligada, marketing_optout_em, sem_pos_venda")
          .eq("id", convRow.whatsapp_contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from("comercial_analises")
      .select("caixinha")
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", leadId)
      .maybeSingle(),
  ]);
  const ct = contato as {
    ia_desligada: boolean | null;
    marketing_optout_em: string | null;
    sem_pos_venda: boolean | null;
  } | null;
  const caixinhaAtual = (fichaAtual as { caixinha?: number | null } | null)?.caixinha ?? null;
  const bloqueado = ct?.marketing_optout_em
    ? "cliente pediu para não receber mensagens"
    : ct?.ia_desligada
      ? "IA desligada para o cliente"
      : ct?.sem_pos_venda
        ? "cliente marcado sem pós-venda"
        : caixinhaAtual === 9
          ? "descartado (não é cliente)"
          : null;
  const qs = (quotes ?? []) as Array<{
    numero: number | null;
    status: string;
    total: number | null;
    created_at: string;
    distancia_km?: number | string | null;
    fora_da_area?: boolean | null;
  }>;
  const vs = (visitas ?? []) as Array<{
    scheduled_date: string | null;
    scheduled_time: string | null;
    status: string | null;
    updated_at: string;
  }>;
  const ps = (pags ?? []) as Array<{ payment_status: string | null; gross_amount: number | null }>;
  const c = (cli ?? null) as Record<string, string | null> | null;
  const pendentes = (fus ?? []) as Array<{
    id: string;
    etapa: string | null;
    scheduled_at: string;
    responsavel: string;
    trilha: string | null;
    origem: string | null;
  }>;
  const f = pendentes[0];
  const retorno = lead["retorno_combinado_em"] as string | null;
  const travas = {
    retornoCombinado:
      (retorno !== null && Date.parse(retorno) > Date.now()) ||
      pendentes.some((p) => p.trilha === "C"),
    toqueMarcado: pendentes.some((p) => p.origem !== "gerente"),
    campanha30Dias: ((envios ?? []) as Array<{ respondido_em: string | null }>).some(
      (e) => !e.respondido_em,
    ),
  };
  const visitaMarcada = vs.some((v) => v.scheduled_date && v.status !== "Concluído");
  const osSemEndereco =
    Boolean(os) && visitaMarcada && !(c?.["full_address"] && c?.["postal_code"]);
  const linhas = [
    `Lead: ${lead["is_open"] === false ? "fechado" : "em aberto"}${lead["perdido_em"] ? " (perdido)" : ""}.`,
    `Orçamentos no app: ${qs.length ? qs.map((q) => `nº ${q.numero ?? "?"} ${q.status} R$ ${q.total ?? "?"} (${q.created_at.slice(0, 10)})`).join("; ") : "nenhum"}.`,
    orcSoltos.length
      ? `Orçamento solto no app com o mesmo telefone (sem ligação com o lead): ${orcSoltos.length}.`
      : null,
    `Orçamento enviado marcado: ${lead["orcamento_enviado_em"] ? `sim (${lead["orcamento_origem"] ?? "app"})` : "não"}.`,
    `OS: ${os ? "sim" : "não"}.`,
    os
      ? `Visitas: ${vs.length ? vs.map((v) => `${v.scheduled_date ?? "sem data"} ${v.scheduled_time ?? ""} ${v.status ?? ""}`.trim()).join("; ") : "nenhuma"}.`
      : null,
    os
      ? `Pagamentos lançados: ${ps.length ? ps.map((p) => `${p.payment_status} R$ ${p.gross_amount ?? "?"}`).join("; ") : "nenhum"}.`
      : null,
    os && wo?.negotiated_payment_method
      ? `Pagamento combinado na OS: ${wo.negotiated_payment_method}.`
      : null,
    `Cadastro do cliente: ${
      c
        ? ["nome", "cpf", "email", "endereco", "cep"]
            .map((k) => {
              const v =
                k === "nome"
                  ? c["full_name"]
                  : k === "cpf"
                    ? c["document_number"]
                    : k === "email"
                      ? c["email"]
                      : k === "endereco"
                        ? c["full_address"]
                        : c["postal_code"];
              return `${k}: ${v ? "preenchido" : "vazio"}`;
            })
            .join(", ")
        : "sem cadastro de cliente (só o lead)"
    }.`,
    `Próximo toque marcado: ${f ? `${f.etapa ?? "toque"} (${f.responsavel}) em ${f.scheduled_at}` : "nenhum"}.`,
    lead["retorno_combinado_em"] ? `Retorno combinado em ${lead["retorno_combinado_em"]}.` : null,
  ].filter(Boolean);
  return {
    texto: linhas.join("\n"),
    estado: {
      orcamentos: [
        ...qs.map((q) => ({ criadoEm: q.created_at })),
        ...orcSoltos.map((q) => ({ criadoEm: q.created_at })),
      ],
      temOs: Boolean(os),
      visitas: vs.map((v) => ({
        data: v.scheduled_date,
        status: v.status,
        atualizadaEm: v.updated_at,
      })),
      // Qualquer pagamento ativo lançado na OS conta (pago, a receber ou parcial), e também a
      // previsão combinada na OS (03/11).
      pagamentoLancado: ps.length > 0 || Boolean(wo?.negotiated_payment_method),
    },
    temOs: Boolean(os),
    osId: os,
    osNumero: wo?.os_number === null || wo?.os_number === undefined ? null : String(wo.os_number),
    clienteId,
    cliente: c
      ? {
          nome: c["full_name"] ?? null,
          cpf: c["document_number"] ?? null,
          email: c["email"] ?? null,
          endereco: c["full_address"] ?? null,
          cep: c["postal_code"] ?? null,
        }
      : null,
    temOrcamento: qs.length > 0 || orcSoltos.length > 0,
    orcamentosAbertos: qs
      .filter((q) => q.status !== "convertido" && q.status !== "recusado")
      .reverse()
      .map((q) => ({
        numero: q.numero,
        distanciaKm:
          q.distancia_km === null || q.distancia_km === undefined ? null : Number(q.distancia_km),
        foraDaArea: Boolean(q.fora_da_area),
      })),
    aberto: lead["is_open"] !== false && !lead["perdido_em"],
    anuncio: Boolean(lead["gclid"] || lead["gbraid"] || lead["lp_origem"]),
    conversaId: convRow?.id ?? null,
    bloqueado,
    caixinha: caixinhaAtual,
    comOrcamento: qs.length > 0 || Boolean(lead["orcamento_enviado_em"]),
    telefone: (lead["phone"] as string | null) ?? (lead["normalized_phone"] as string | null),
    nome: ((lead["lead_name"] as string | null) ?? "").trim(),
    pendente: f
      ? { id: f.id, etapa: f.etapa, quando: f.scheduled_at, responsavel: f.responsavel }
      : null,
    travas,
    osSemEndereco,
    ultimaDoCliente:
      (ultimaCli as { message_timestamp?: string } | null)?.message_timestamp ?? null,
  };
}

// ---------------------------------------------------------------- IA

async function pedirDecisao(
  sistema: string,
  conteudo: string,
  opus = false,
): Promise<{ decisao: DecisaoIA; custo: number }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { chamarIa } = await import("@/lib/alice/parada-ia.server");
  const resp = await chamarIa(() =>
    new Anthropic({ timeout: opus ? 300_000 : 90_000, maxRetries: 1 }).messages.create({
      model: opus ? MODELO_OPUS : MODELO_HAIKU,
      max_tokens: opus ? 16_000 : 4_000,
      output_config: {
        effort: opus ? "medium" : "low",
        format: {
          type: "json_schema",
          schema: ESQUEMA_DECISAO as unknown as Record<string, unknown>,
        },
      },
      system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: conteudo }],
    }),
  );
  if (resp.stop_reason === "refusal") throw new Error("a IA recusou a decisão");
  if (resp.stop_reason === "max_tokens") throw new Error("decisão cortada (limite de tokens)");
  const texto = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return {
    decisao: JSON.parse(texto) as DecisaoIA,
    custo: custoUsd(resp.usage, opus ? PRECO_OPUS : PRECO_HAIKU),
  };
}

/** Mensagem da equipe (negociação ou toque humano) reescrita pelo Sonnet, para ficar no roteiro. */
async function melhorarMensagem(
  conversa: string,
  motivo: string,
  rascunho: string,
  pixPct: number | null,
): Promise<{ mensagem: string; custo: number }> {
  // Mensagem pronta sempre no Sonnet (05/11, custo): a decisão continua no Opus.
  const preco = undefined;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { chamarIa } = await import("@/lib/alice/parada-ia.server");
  const resp = await chamarIa(() =>
    new Anthropic({ timeout: 90_000, maxRetries: 1 }).messages.create({
      model: MODELO_FICHA,
      max_tokens: 2_000,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["mensagem"],
            properties: { mensagem: { type: "string" } },
          },
        },
      },
      system: [
        "Você escreve a mensagem de WhatsApp que uma vendedora vai copiar e mandar a um cliente de limpeza de estofados. Até 3 frases curtas, tom humano e carinhoso, sem pressão.",
        'Use o contexto da conversa (cite algo específico); empatia primeiro se o cliente contou um problema; termine com UMA pergunta simples para o cliente responder (ex.: "Conseguiu ver um dia bom para agendarmos?", "Quer que eu já reserve um horário pra você?", "Tem alguma coisa te impedindo de decidir que eu possa ajudar?").',
        `Nunca ofereça nem prometa desconto, condição melhor ou "ver com a equipe/gestor uma condição". Se a conversa já teve desconto, só lembre o valor com desconto que já foi passado. Ao falar de preço, use o valor da conversa, com o Pix${pixPct ? ` (${String(pixPct).replace(".", ",")}% de desconto)` : ""} quando for o caso. Nunca invente prazo ou horário que não estejam na conversa.`,
        'Proibido: "ficou alguma dúvida", "passando para saber", "conseguiu decidir", "está aí?", "fico à disposição". Não se apresente com nome.',
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: `Motivo do contato: ${motivo}\nRascunho: ${rascunho}\n\nConversa (fim):\n${conversa.slice(-12_000)}`,
        },
      ],
    }),
  );
  if (resp.stop_reason !== "end_turn")
    return { mensagem: rascunho, custo: custoUsd(resp.usage, preco) };
  const texto = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const m = (JSON.parse(texto) as { mensagem?: string }).mensagem?.trim();
  return { mensagem: m || rascunho, custo: custoUsd(resp.usage, preco) };
}

// ---------------------------------------------------------------- um lead

type ContextoNoite = {
  noite: Noite;
  sistema: string;
  temAlice: boolean;
  pixPct: number | null;
  motivos: Array<{ id: string; nome: string }>;
  pessoas: PessoaEquipe[];
  /** Equipe única: sem dono por pessoa (tarefas e acertos da equipe, um recado só). */
  equipeUnica: boolean;
  /** Vendedoras ativas com login (sem a IA): os nomes do recado da equipe. */
  nomesAtendentes: string[];
  amanha: string;
  horario: HorarioUtil;
  /** Modo ativo: os toques da Alice decididos pela noite são executados pela fila. */
  modoAtivo: boolean;
  especiais: EspeciaisDaNoite;
  /** Leitura no Opus 5.5 (mais recurso): decisão e mensagem pronta. */
  opus: boolean;
  /** Leitura completa: o limite de 15 vale só para tarefas extras (negociação). */
  leituraCompleta: boolean;
  /** Feriados bloqueados nos próximos 30 dias (data → nome), para os acertos com data. */
  bloqueados: ReadonlyMap<string, string>;
  /** Próximos dias com horário livre depois de uma data (até 3), pela agenda real. */
  livresDepois: (data: string) => string[];
};

async function decidirLead(db: Db, ctx: ContextoNoite, leadId: string): Promise<number> {
  const { noite } = ctx;
  const emp = noite.empresa_id;
  const { entradaDoLead } = await import("./analise.server");
  const [{ entrada }, est, dono] = await Promise.all([
    entradaDoLead(db, emp, leadId),
    estadoDoLead(db, emp, leadId),
    ctx.equipeUnica ? Promise.resolve(null) : donoDoLead(db, emp, leadId, ctx.pessoas),
  ]);
  const fatos = calcularFatos(entrada);
  let conversa = conversaEmTexto(entrada.mensagens);
  if (conversa.length > MAX_CONVERSA)
    conversa = `[... início omitido ...]\n${conversa.slice(-MAX_CONVERSA)}`;
  const { decisao, custo: c1 } = await pedirDecisao(
    ctx.sistema,
    [
      `Hoje: ${horarioSP(new Date()).data} (amanhã é ${ctx.amanha}).`,
      "",
      "NO APP:",
      est.texto,
      "",
      "CONVERSA:",
      conversa || "(sem mensagens)",
    ].join("\n"),
    ctx.opus,
  );
  let custo = c1;
  // Desfecho que tira o lead da leitura só com frase clara do cliente (05/11).
  const conferido = confereDesfecho(
    decisao,
    entrada.mensagens
      .filter((m) => quemMandou(m) === "cliente")
      .map((m) => `${m.texto ?? ""} ${m.transcricao ?? ""}`),
    est.temOrcamento,
  );
  if (conferido.rebaixado) {
    decisao.caixinha = conferido.caixinha;
    decisao.acao = conferido.acao;
    decisao.motivo = `sem frase clara do cliente: segue aberto · ${decisao.motivo}`;
    decisao.frase_cliente = "";
    const r = (noite.resumo ?? {}) as { desfechoSemFrase?: number };
    noite.resumo = { ...r, desfechoSemFrase: (r.desfechoSemFrase ?? 0) + 1 };
  }
  // Frase que justificou o desfecho: fica na ficha.
  const fraseDesfecho =
    decisao.caixinha === 7 || decisao.caixinha === 9 || decisao.acao === "parar"
      ? decisao.frase_cliente.trim().slice(0, 300) || null
      : null;

  // Demoras: só para quem chegou nas últimas ~26 h (contadas pelo sistema).
  const novo =
    fatos.primeiraMensagemCliente &&
    Date.now() - Date.parse(fatos.primeiraMensagemCliente) <= 26 * 3_600_000;
  const demoras = novo
    ? demorasDaEquipe({
        primeiraRespostaMin: fatos.primeiraRespostaMin,
        primeiraRespostaDe: fatos.primeiraRespostaDe,
        tempoAtePrecoMin: fatos.tempoAtePrecoMin,
        anuncio: est.anuncio,
      })
    : [];
  // Regras das cobranças (02/11): fechou só com data combinada (senão aguardando), orçamento sem
  // app só com preço (senão próximo passo), nada sem texto, uma por assunto, feriado vira remarcar.
  const saneado = saneaAcertos(decisao.acertos, {
    bloqueados: ctx.bloqueados,
    livresDepois: ctx.livresDepois,
  });
  {
    const r = (noite.resumo ?? {}) as {
      acertosDescartados?: Record<string, number>;
      acertosJuntados?: number;
    };
    const acertosDescartados = { ...(r.acertosDescartados ?? {}) };
    for (const d of saneado.descartes)
      acertosDescartados[d.motivo] = (acertosDescartados[d.motivo] ?? 0) + 1;
    noite.resumo = {
      ...r,
      acertosDescartados,
      acertosJuntados:
        (r.acertosJuntados ?? 0) + saneado.acertos.filter((a) => a.juntou.length).length,
    };
  }
  if (est.aberto && !est.bloqueado && saneado.proximoPasso) {
    if (decisao.acao === "esperar") {
      decisao.acao = "chamar";
      decisao.quando = "";
      decisao.responsavel = "equipe";
    }
    if (decisao.acao === "chamar" || decisao.acao === "agendar")
      decisao.motivo = `Próximo passo: ${saneado.proximoPasso} · ${decisao.motivo}`.slice(0, 300);
  } else if (est.aberto && !est.bloqueado && saneado.aguardando && decisao.acao === "esperar") {
    decisao.acao = "agendar";
    decisao.quando = `${somarDias(noite.noite, 2)}T09:00`;
    decisao.responsavel = "equipe";
    decisao.motivo =
      `Aguardando: o cliente disse que aprova e volta para agendar; confirmar · ${decisao.motivo}`.slice(
        0,
        300,
      );
  }
  // Acertos (31/10): só de conversa com o cliente nos últimos 7 dias; cadastro só o do sistema (OS
  // agendada sem endereço ou CEP); pagamento só com OS; o que o app já mostra certo não entra.
  const conversaRecente =
    est.ultimaDoCliente !== null && Date.now() - Date.parse(est.ultimaDoCliente) <= 7 * 86_400_000;
  const acertos: Array<{ tipo: TipoCobranca; texto: string; dados: Record<string, unknown> }> = [
    ...(conversaRecente ? saneado.acertos : [])
      .filter((a) => a.tipo !== "cadastro")
      .filter((a) => !(a.tipo === "orcamento_sem_app" && est.estado.orcamentos.length))
      .filter((a) => !(a.tipo === "fechou_sem_os" && est.temOs))
      .filter((a) => !(a.tipo === "pagamento" && (!est.temOs || est.estado.pagamentoLancado)))
      .map((a) => ({
        tipo: a.tipo as TipoCobranca,
        texto: a.texto.slice(0, 400),
        dados: {
          itens: a.itens,
          prioridade: decisao.prioridade,
          ...(a.data ? { data: a.data } : {}),
          ...(a.juntou.length ? { juntou: a.juntou } : {}),
        },
      })),
    ...(est.osSemEndereco
      ? [
          {
            tipo: "cadastro" as TipoCobranca,
            texto: "A visita está marcada e o cadastro do cliente está sem endereço ou CEP.",
            dados: { prioridade: decisao.prioridade },
          },
        ]
      : []),
    ...demoras.map((d) => ({ tipo: d.tipo as TipoCobranca, texto: d.texto, dados: {} })),
  ];

  // Conferência: só conta (por tipo e por pessoa), nada visível. A decisão crua fica gravada
  // (sem tarefa, toque, cobrança nem ação) para comparar e medir o custo (noite de medição, 03/11).
  if (noite.modo === "conferencia") {
    await db.from("comercial_decisoes").upsert(
      {
        empresa_id: emp,
        noite_id: noite.id,
        crm_lead_id: leadId,
        conversa_id: est.conversaId,
        caixinha: decisao.caixinha,
        acao: decisao.acao,
        quando: quandoParaIso(decisao.quando),
        responsavel: decisao.responsavel,
        motivo: decisao.motivo.slice(0, 300),
        mensagem: decisao.mensagem.slice(0, 1000) || null,
        padrao_faria: padraoFaria(est.pendente),
        executada: false,
        modelo: ctx.opus ? MODELO_OPUS : MODELO_HAIKU,
        custo_usd: custo,
      },
      { onConflict: "noite_id,crm_lead_id" },
    );
    const r = (noite.resumo ?? {}) as {
      porTipo?: Record<string, number>;
      porPessoa?: Record<string, number>;
      leads?: number;
    };
    const porTipo = { ...(r.porTipo ?? {}) };
    const porPessoa = { ...(r.porPessoa ?? {}) };
    const nomeDono = ctx.equipeUnica
      ? "Equipe"
      : ctx.pessoas.find((p) => p.userId === dono)?.nome || "(sem dono)";
    for (const a of acertos) {
      porTipo[a.tipo] = (porTipo[a.tipo] ?? 0) + 1;
      porPessoa[nomeDono] = (porPessoa[nomeDono] ?? 0) + 1;
    }
    const caixinhas = { ...((r as { caixinhas?: Record<string, number> }).caixinhas ?? {}) };
    caixinhas[String(decisao.caixinha)] = (caixinhas[String(decisao.caixinha)] ?? 0) + 1;
    noite.resumo = { ...r, porTipo, porPessoa, caixinhas, leads: (r.leads ?? 0) + 1 };
    return custo;
  }

  // Lead fechado (OS) ou perdido: só os acertos; a ação fica "esperar".
  if (!est.aberto && decisao.acao !== "esperar") decisao.acao = "esperar";
  // Travas (31/10): tarefa só para as caixinhas 2 a 5, sem retorno combinado, sem outro toque
  // marcado e sem campanha nos últimos 30 dias; caixinha 6 vai para a campanha da semana.
  const travado = aplicarTravas({ caixinha: decisao.caixinha, acao: decisao.acao }, est.travas);
  decisao.acao = travado.acao;
  if (travado.trava) decisao.motivo = `${travado.trava} · ${decisao.motivo}`;
  {
    const r = (noite.resumo ?? {}) as {
      travas?: Record<string, number>;
      campanhaDaSemana?: number;
    };
    const travas = { ...(r.travas ?? {}) };
    if (travado.trava) travas[travado.trava] = (travas[travado.trava] ?? 0) + 1;
    noite.resumo = {
      ...r,
      travas,
      campanhaDaSemana: (r.campanhaDaSemana ?? 0) + (travado.campanhaDaSemana ? 1 : 0),
    };
  }
  // Nunca tarefa, toque nem campanha (opt-out, IA desligada, sem pós-venda, descartado).
  if (est.bloqueado && decisao.acao !== "parar") {
    decisao.acao = "esperar";
    decisao.motivo = `${est.bloqueado} · ${decisao.motivo}`;
  }
  // Follow-up que ninguém fez: tarefa "follow-up esquecido", prioridade máxima, antes de tudo.
  const esquecidoEm = est.bloqueado ? null : (ctx.especiais.esquecidos[leadId] ?? null);
  if (esquecidoEm && decisao.acao !== "parar" && !bloqueadaParaVenda(decisao.caixinha)) {
    decisao.acao = "chamar";
    decisao.prioridade = 1;
    decisao.quando = "";
    decisao.motivo = textoFollowUpEsquecido(esquecidoEm);
  }
  const ligar = Boolean(decisao.pediu_ligacao) && !est.bloqueado;
  let responsavel: "alice" | "equipe" =
    !ctx.temAlice || decisao.negociacao || ligar || Boolean(esquecidoEm)
      ? "equipe"
      : decisao.responsavel;
  let mensagem = decisao.mensagem.trim();
  if (
    mensagem &&
    responsavel === "equipe" &&
    (decisao.acao === "chamar" || decisao.acao === "agendar")
  ) {
    const m = await melhorarMensagem(conversa, decisao.motivo, mensagem, ctx.pixPct).catch(
      () => null,
    );
    if (m) {
      mensagem = m.mensagem;
      custo += m.custo;
    }
  }
  // Oferta de condição (05/11): fora do toque de desconto, a mensagem não sai pronta.
  if (temOfertaDeCondicao(mensagem)) {
    mensagem = "";
    if (decisao.acao === "chamar" || decisao.acao === "agendar") {
      responsavel = "equipe";
      decisao.motivo = `${MOTIVO_OFERTA} · ${decisao.motivo}`;
    }
  }
  // Lacuna ("R$ ___", "[nome]"): a mensagem nunca sai pronta; vira tarefa da equipe (04/11).
  if (temLacuna(mensagem)) {
    mensagem = "";
    if (decisao.acao === "chamar" || decisao.acao === "agendar") {
      responsavel = "equipe";
      decisao.motivo = `${MOTIVO_LACUNA} · ${decisao.motivo}`;
    }
  }
  const quandoPedido =
    (ligar ? quandoParaIso(decisao.ligar_quando) : null) ?? quandoParaIso(decisao.quando);
  const quandoBruto =
    quandoPedido ??
    (decisao.acao === "chamar" ? new Date(`${ctx.amanha}T09:00:00-03:00`).toISOString() : null);
  // Tarefa só em dia/hora útil da empresa; o que cair fora vai para o próximo horário útil.
  const quando =
    quandoBruto && (decisao.acao === "chamar" || decisao.acao === "agendar")
      ? proximoHorarioUtil(quandoBruto, ctx.horario)
      : quandoBruto;
  // Próxima olhada: chamar → dia seguinte à tarefa; agendar → véspera; esperar → data combinada
  // ou 7 dias; parar → nenhuma. Lead bloqueado não volta.
  const reverEm = est.bloqueado
    ? null
    : reverEmIso(diaDeRever({ acao: decisao.acao, quando, hoje: horarioSP(new Date()).data }));
  const reverMotivo = reverEm
    ? decisao.acao === "chamar"
      ? "ver se respondeu à tarefa"
      : decisao.acao === "agendar"
        ? "véspera da data combinada"
        : "esperando o cliente"
    : null;
  const motivoPerda =
    decisao.acao === "parar"
      ? (ctx.motivos.find((m) => m.nome.toLowerCase() === decisao.motivo_perda.trim().toLowerCase())
          ?.id ?? null)
      : null;

  // Caixinha e etiquetas na ficha do lead (cria a ficha mínima se ainda não existir).
  const { data: ficha } = await db
    .from("comercial_analises")
    .select("id")
    .eq("empresa_id", emp)
    .eq("crm_lead_id", leadId)
    .maybeSingle();
  const etiquetas = {
    servico: decisao.servico || null,
    data_evento: /^\d{4}-\d{2}-\d{2}$/.test(decisao.data_evento) ? decisao.data_evento : null,
    valor_orcado: decisao.valor_orcado,
  };
  const foraArea =
    decisao.caixinha === 8
      ? { cidade: decisao.cidade || null, bairro: decisao.bairro || null }
      : null;
  if (ficha) {
    await db
      .from("comercial_analises")
      .update({
        caixinha: decisao.caixinha,
        caixinha_em: new Date().toISOString(),
        etiquetas,
        fora_area: foraArea,
        rever_em: reverEm,
        rever_motivo: reverMotivo,
        ...(fraseDesfecho ? { frase_cliente: fraseDesfecho } : {}),
      })
      .eq("id", (ficha as { id: string }).id);
  } else {
    await db.from("comercial_analises").insert({
      empresa_id: emp,
      crm_lead_id: leadId,
      grupo: est.anuncio ? "google" : "outras",
      status: "pendente",
      fatos,
      caixinha: decisao.caixinha,
      caixinha_em: new Date().toISOString(),
      etiquetas,
      fora_area: foraArea,
      rever_em: reverEm,
      rever_motivo: reverMotivo,
      frase_cliente: fraseDesfecho,
    });
  }

  // Tarefa da equipe (crm_followups, trilha G). A anterior da Tatiana para o lead é substituída.
  let followupId: string | null = null;
  if (
    responsavel === "equipe" &&
    (decisao.acao === "chamar" || decisao.acao === "agendar") &&
    quando
  ) {
    await db
      .from("crm_followups")
      .update({ status: "Cancelada", notes: `substituída pela ${NOME_GERENTE}` })
      .eq("empresa_id", emp)
      .eq("crm_lead_id", leadId)
      .eq("origem", "gerente")
      .eq("status", "Pendente");
    const { data: fu } = await db
      .from("crm_followups")
      .insert({
        empresa_id: emp,
        crm_lead_id: leadId,
        conversa_id: est.conversaId,
        scheduled_at: quando,
        status: "Pendente",
        responsavel: "equipe",
        assigned_to: dono,
        trilha: "G",
        // GX = tarefa extra (negociação): só ela conta no limite de 15 na leitura completa.
        etapa: decisao.negociacao || decisao.caixinha === 2 ? "GX" : "G1",
        canal: "equipe",
        origem: "gerente",
        mensagem: mensagem.slice(0, 1000) || null,
        motivo: decisao.motivo.slice(0, 300) || null,
        prioridade: decisao.prioridade,
        tarefa_tipo: esquecidoEm ? "follow_up_esquecido" : ligar ? "ligar" : "mensagem",
        notes: `${NOME_GERENTE}: ${decisao.motivo}`.slice(0, 500),
      })
      .select("id")
      .single();
    followupId = (fu as { id: string } | null)?.id ?? null;
    if (esquecidoEm)
      acertos.push({
        tipo: "follow_up_esquecido",
        texto: `${textoFollowUpEsquecido(esquecidoEm)} A tarefa de hoje repõe o toque.`,
        dados: { prioridade: 1 },
      });
  }
  // Toque da Alice (modo ativo): entra na fila dela, que respeita a janela de 24 h (fora dela,
  // só com modelo aprovado; sem modelo, a tarefa vira da equipe). No teste, só fica registrado.
  if (
    ctx.modoAtivo &&
    responsavel === "alice" &&
    (decisao.acao === "chamar" || decisao.acao === "agendar") &&
    quando &&
    est.conversaId
  ) {
    followupId = await agendarToqueDaTatiana(db, {
      empresaId: emp,
      leadId,
      conversaId: est.conversaId,
      quando,
      motivo: decisao.motivo,
      mensagem,
      comOrcamento: est.comOrcamento,
    });
  }

  await db.from("comercial_decisoes").upsert(
    {
      empresa_id: emp,
      noite_id: noite.id,
      crm_lead_id: leadId,
      conversa_id: est.conversaId,
      caixinha: decisao.caixinha,
      acao: decisao.acao,
      quando,
      responsavel,
      responsavel_user_id: responsavel === "equipe" ? dono : null,
      motivo: decisao.motivo.slice(0, 300),
      mensagem: mensagem.slice(0, 1000) || null,
      motivo_perda_id: motivoPerda,
      padrao_faria: padraoFaria(est.pendente),
      followup_id: followupId,
      rever_em: reverEm,
      // No teste, a ação da Alice não é executada (a cadência padrão segue valendo).
      executada: Boolean(followupId),
      modelo: ctx.opus ? MODELO_OPUS : MODELO_HAIKU,
      custo_usd: custo,
    },
    { onConflict: "noite_id,crm_lead_id" },
  );

  // Cobranças: resolve as pendentes que o app já mostra certas e cria as novas (uma pendente por tipo).
  const { data: pend } = await db
    .from("comercial_cobrancas")
    .select("id, tipo, criada_em")
    .eq("empresa_id", emp)
    .eq("crm_lead_id", leadId)
    .eq("situacao", "pendente");
  for (const p of (pend ?? []) as Array<{ id: string; tipo: TipoCobranca; criada_em: string }>) {
    if (resolvidaPeloApp({ tipo: p.tipo, criadaEm: p.criada_em }, est.estado))
      await db
        .from("comercial_cobrancas")
        .update({ situacao: "resolvida", resolvida_em: new Date().toISOString() })
        .eq("id", p.id);
  }
  // Uma por lead e tipo: se já houve uma do mesmo tipo nos últimos 7 dias (qualquer situação), não
  // cria outra. Nasce fora da lista da equipe; no fim da noite as mais importantes entram.
  const { data: recentes } = await db
    .from("comercial_cobrancas")
    .select("tipo")
    .eq("empresa_id", emp)
    .eq("crm_lead_id", leadId)
    .gte("criada_em", new Date(Date.now() - 7 * 86_400_000).toISOString());
  const jaTem = new Set(((recentes ?? []) as Array<{ tipo: string }>).map((r) => r.tipo));
  const cobrancasDaNoite = new Map<TipoCobranca, string>();
  for (const a of acertos) {
    if (jaTem.has(a.tipo)) continue;
    jaTem.add(a.tipo);
    const { data: nova, error } = await db
      .from("comercial_cobrancas")
      .insert({
        empresa_id: emp,
        noite_id: noite.id,
        crm_lead_id: leadId,
        conversa_id: est.conversaId,
        user_id: dono,
        tipo: a.tipo,
        texto: a.texto,
        dados: a.dados,
        anuncio: est.anuncio,
        visivel_equipe: false,
      })
      .select("id")
      .maybeSingle();
    // Já existe uma pendente do mesmo tipo para o lead: fica a que está.
    if (error && error.code !== "23505") throw new Error(`cobrança: ${error.message}`);
    if ((nova as { id?: string } | null)?.id)
      cobrancasDaNoite.set(a.tipo, (nova as { id: string }).id);
  }
  // A Tatiana faz e informa (03/11): previsão de pagamento na OS, orçamento em rascunho e
  // cadastro, só em modo ativo (em teste registra "faria"); cada ação tem Desfazer no app.
  if (conversaRecente && !est.bloqueado) {
    const planejadas = planejarAcoes(saneado.acertos, {
      osId: est.osId,
      osNumero: est.osNumero,
      pagamentoLancado: est.estado.pagamentoLancado,
      temOrcamento: est.temOrcamento,
      clienteId: est.clienteId,
      cliente: est.cliente,
      leadNome: est.nome || null,
      telefone: est.telefone,
      orcamentosAbertos: est.orcamentosAbertos,
      hoje: noite.noite,
    });
    // B7: fechou sem OS que a Tatiana não pode virar sozinha: o motivo vai para o acerto da equipe.
    const idFechou = cobrancasDaNoite.get("fechou_sem_os");
    const fechou = saneado.acertos.find((x) => x.tipo === "fechou_sem_os");
    if (idFechou && fechou && !planejadas.some((p) => p.tipo === "virar_os")) {
      const v = avaliarVirarOs(fechou, {
        osId: est.osId,
        osNumero: est.osNumero,
        pagamentoLancado: est.estado.pagamentoLancado,
        temOrcamento: est.temOrcamento,
        clienteId: est.clienteId,
        cliente: est.cliente,
        leadNome: est.nome || null,
        telefone: est.telefone,
        orcamentosAbertos: est.orcamentosAbertos,
        hoje: noite.noite,
      });
      if (!v.ok && v.motivo !== "não se aplica")
        await db
          .from("comercial_cobrancas")
          .update({
            texto: `${fechou.texto} A ${NOME_GERENTE} não criou a OS: ${v.motivo}.`.slice(0, 600),
          })
          .eq("id", idFechou);
    }
    if (planejadas.length) {
      const { executarAcoesDaNoite } = await import("./acoes.server");
      const r = await executarAcoesDaNoite(db, {
        empresaId: emp,
        noiteId: noite.id,
        leadId,
        conversaId: est.conversaId,
        modoAtivo: ctx.modoAtivo,
        hoje: noite.noite,
        acoes: planejadas,
        cobrancas: cobrancasDaNoite,
        quandoTarefa: proximoHorarioUtil(
          new Date(`${ctx.amanha}T09:00:00-03:00`).toISOString(),
          ctx.horario,
        ),
      }).catch((e) => {
        console.error("Tatiana: ações da noite", e instanceof Error ? e.message : e);
        return { feitas: 0, faria: 0, falhou: planejadas.length };
      });
      const rs = (noite.resumo ?? {}) as { acoes?: Record<string, number> };
      const acoesResumo = { ...(rs.acoes ?? {}) };
      for (const k of ["feitas", "faria", "falhou"] as const)
        acoesResumo[k] = (acoesResumo[k] ?? 0) + r[k];
      noite.resumo = { ...rs, acoes: acoesResumo };
    }
  }
  return custo;
}

// ---------------------------------------------------------------- toque da Alice (modo ativo)

/**
 * Agenda na fila da Alice o toque decidido pela noite (trilha G). A fila respeita a janela de 24 h:
 * fora dela, só pelo modelo de retomada aprovado (lead com orçamento); senão a tarefa vira da equipe.
 */
async function agendarToqueDaTatiana(
  db: Db,
  o: {
    empresaId: string;
    leadId: string;
    conversaId: string;
    quando: string;
    motivo: string;
    mensagem: string;
    comOrcamento: boolean;
  },
): Promise<string | null> {
  const { data: t, error } = await db
    .from("ia_tarefas")
    .insert({
      empresa_id: o.empresaId,
      conversa_id: o.conversaId,
      tipo: "followup",
      executar_apos: o.quando,
      motivo: `${NOME_GERENTE}: ${o.motivo}`.slice(0, 300),
      dados: {
        cadencia: false,
        trilha: "G",
        etapa: "G1",
        motivo: o.motivo,
        mensagem_sugerida: o.mensagem,
        com_orcamento: o.comOrcamento,
      } as never,
    })
    .select("id")
    .single();
  if (error || !t) return null;
  const { data: fu } = await db
    .from("crm_followups")
    .insert({
      empresa_id: o.empresaId,
      crm_lead_id: o.leadId,
      conversa_id: o.conversaId,
      scheduled_at: o.quando,
      status: "Pendente",
      responsavel: "alice",
      ia_tarefa_id: (t as { id: string }).id,
      trilha: "G",
      etapa: "G1",
      origem: "gerente",
      mensagem: o.mensagem.slice(0, 1000) || null,
      motivo: o.motivo.slice(0, 300) || null,
      tarefa_tipo: "mensagem",
      notes: `🤖 Toque da ${NOME_GERENTE}: ${o.motivo}`.slice(0, 500),
    })
    .select("id")
    .single();
  return (fu as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------- tarefas sem IA

type TarefaDireta = {
  leadId: string;
  conversaId: string | null;
  tipo: "pos_venda" | "remarcar";
  caixinha: 1 | 2;
  motivo: string;
  mensagem: string;
  reverEm: string | null;
};

/** Cria a tarefa (uma por lead e tipo em 7 dias) e ajusta a caixinha e a próxima olhada da ficha. */
async function criarTarefaDireta(
  db: Db,
  emp: string,
  t: TarefaDireta,
  quando: string,
  dono: string | null,
  anuncio: boolean,
): Promise<boolean> {
  const { data: ja } = await db
    .from("crm_followups")
    .select("id")
    .eq("empresa_id", emp)
    .eq("crm_lead_id", t.leadId)
    .eq("tarefa_tipo", t.tipo)
    .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .limit(1);
  if (ja?.length) return false;
  await db.from("crm_followups").insert({
    empresa_id: emp,
    crm_lead_id: t.leadId,
    conversa_id: t.conversaId,
    scheduled_at: quando,
    status: "Pendente",
    responsavel: "equipe",
    assigned_to: dono,
    trilha: "G",
    etapa: "G1",
    canal: "equipe",
    origem: "gerente",
    mensagem: t.mensagem.slice(0, 1000),
    motivo: t.motivo.slice(0, 300),
    prioridade: t.tipo === "remarcar" ? 2 : 3,
    tarefa_tipo: t.tipo,
    notes: `${NOME_GERENTE}: ${t.motivo}`.slice(0, 500),
  });
  const { data: ficha } = await db
    .from("comercial_analises")
    .select("id")
    .eq("empresa_id", emp)
    .eq("crm_lead_id", t.leadId)
    .maybeSingle();
  const campos = {
    caixinha: t.caixinha,
    caixinha_em: new Date().toISOString(),
    rever_em: t.reverEm,
    rever_motivo: t.tipo === "remarcar" ? "ver se remarcou" : "pós-venda feito?",
  };
  if (ficha)
    await db
      .from("comercial_analises")
      .update(campos)
      .eq("id", (ficha as { id: string }).id);
  else
    await db.from("comercial_analises").insert({
      empresa_id: emp,
      crm_lead_id: t.leadId,
      grupo: anuncio ? "google" : "outras",
      status: "pendente",
      fatos: {},
      ...campos,
    });
  return true;
}

/** Contato bloqueado (opt-out, IA desligada, sem pós-venda) pelo lead. */
async function leadBloqueado(db: Db, emp: string, leadId: string): Promise<boolean> {
  const { data: conv } = await db
    .from("conversas")
    .select("whatsapp_contact_id")
    .eq("empresa_id", emp)
    .eq("crm_lead_id", leadId)
    .not("whatsapp_contact_id", "is", null)
    .limit(1)
    .maybeSingle();
  const cid = (conv as { whatsapp_contact_id?: string } | null)?.whatsapp_contact_id;
  if (!cid) return false;
  const { data: c } = await db
    .from("whatsapp_contacts")
    .select("ia_desligada, marketing_optout_em, sem_pos_venda")
    .eq("id", cid)
    .maybeSingle();
  const ct = c as {
    ia_desligada: boolean | null;
    marketing_optout_em: string | null;
    sem_pos_venda: boolean | null;
  } | null;
  return Boolean(ct?.ia_desligada || ct?.marketing_optout_em || ct?.sem_pos_venda);
}

/**
 * Tarefas que o sistema cria sem a IA, na abertura da noite: pós-venda D+1 (serviço concluído
 * hoje) e remarcar (OS ou visita cancelada desde a última passada, sem outra data).
 */
async function tarefasDiretas(
  db: Db,
  ctx: { emp: string; hoje: string; amanha: string; horario: HorarioUtil; equipeUnica: boolean },
  pessoas: PessoaEquipe[],
  desde: string,
): Promise<{ pos_venda: number; remarcar: number }> {
  const { emp, hoje, amanha, horario } = ctx;
  const inicioHoje = new Date(`${hoje}T00:00:00-03:00`).toISOString();
  const [{ data: concluidas }, { data: canceladasOs }, { data: canceladasVis }] = await Promise.all(
    [
      db
        .from("visits")
        .select("work_order_id, service_type:service_type_id ( name )")
        .eq("empresa_id", emp)
        .eq("status", "Concluído")
        .gte("updated_at", inicioHoje)
        .limit(200),
      db
        .from("work_orders")
        .select("id, os_number")
        .eq("empresa_id", emp)
        .eq("status", "Cancelada")
        .gte("updated_at", desde)
        .limit(200),
      db
        .from("visits")
        .select("work_order_id")
        .eq("empresa_id", emp)
        .eq("status", "Cancelado")
        .gte("updated_at", desde)
        .limit(200),
    ],
  );
  const saida = { pos_venda: 0, remarcar: 0 };
  const quando = proximoHorarioUtil(new Date(`${amanha}T10:00:00-03:00`).toISOString(), horario);
  const leadDaOs = async (osId: string) => {
    const { data } = await db
      .from("crm_leads")
      .select("id, lead_name, perdido_em, gclid, gbraid, lp_origem")
      .eq("empresa_id", emp)
      .eq("linked_work_order_id", osId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data as {
      id: string;
      lead_name: string | null;
      perdido_em: string | null;
      gclid: string | null;
      gbraid: string | null;
      lp_origem: string | null;
    } | null;
  };
  const conversaDoLead = async (leadId: string) => {
    const { data } = await db
      .from("conversas")
      .select("id")
      .eq("empresa_id", emp)
      .eq("crm_lead_id", leadId)
      .order("ultima_atividade_em", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  };
  const donoDe = async (leadId: string) =>
    ctx.equipeUnica ? null : donoDoLead(db, emp, leadId, pessoas);

  // Pós-venda D+1.
  const vistas = new Set<string>();
  for (const v of (concluidas ?? []) as unknown as Array<{
    work_order_id: string;
    service_type: { name: string | null } | null;
  }>) {
    if (vistas.has(v.work_order_id)) continue;
    vistas.add(v.work_order_id);
    const lead = await leadDaOs(v.work_order_id);
    if (!lead || lead.perdido_em || (await leadBloqueado(db, emp, lead.id))) continue;
    const { data: os } = await db
      .from("work_orders")
      .select("os_number")
      .eq("id", v.work_order_id)
      .maybeSingle();
    const t = textoPosVenda({
      nome: primeiroNomeLimpo(lead.lead_name) ?? "",
      servico: v.service_type?.name ?? null,
      osNumero:
        (os as { os_number?: string | number | null } | null)?.os_number?.toString() ?? null,
    });
    const ok = await criarTarefaDireta(
      db,
      emp,
      {
        leadId: lead.id,
        conversaId: await conversaDoLead(lead.id),
        tipo: "pos_venda",
        caixinha: 1,
        motivo: t.motivo,
        mensagem: t.mensagem,
        reverEm: null,
      },
      quando,
      await donoDe(lead.id),
      Boolean(lead.gclid || lead.gbraid || lead.lp_origem),
    );
    if (ok) saida.pos_venda++;
  }

  // Remarcar: OS cancelada, ou visita cancelada sem outra visita futura na mesma OS.
  const osCanceladas = new Map<string, string | null>();
  for (const o of (canceladasOs ?? []) as Array<{ id: string; os_number: string | number | null }>)
    osCanceladas.set(o.id, o.os_number?.toString() ?? null);
  for (const v of (canceladasVis ?? []) as Array<{ work_order_id: string }>) {
    if (osCanceladas.has(v.work_order_id)) continue;
    const { data: outras } = await db
      .from("visits")
      .select("id")
      .eq("work_order_id", v.work_order_id)
      .neq("status", "Cancelado")
      .gte("scheduled_date", hoje)
      .limit(1);
    if (outras?.length) continue;
    const { data: os } = await db
      .from("work_orders")
      .select("os_number, status")
      .eq("id", v.work_order_id)
      .maybeSingle();
    const w = os as { os_number?: string | number | null; status?: string } | null;
    if (w?.status === "Concluída") continue;
    osCanceladas.set(v.work_order_id, w?.os_number?.toString() ?? null);
  }
  for (const [osId, osNumero] of osCanceladas) {
    const lead = await leadDaOs(osId);
    if (!lead || lead.perdido_em || (await leadBloqueado(db, emp, lead.id))) continue;
    const t = textoRemarcar({ nome: primeiroNomeLimpo(lead.lead_name) ?? "", osNumero });
    const ok = await criarTarefaDireta(
      db,
      emp,
      {
        leadId: lead.id,
        conversaId: await conversaDoLead(lead.id),
        tipo: "remarcar",
        caixinha: 2,
        motivo: t.motivo,
        mensagem: t.mensagem,
        reverEm: reverEmIso(somarDias(amanha, 1)),
      },
      quando,
      await donoDe(lead.id),
      Boolean(lead.gclid || lead.gbraid || lead.lp_origem),
    );
    if (ok) saida.remarcar++;
  }
  return saida;
}

/**
 * Tarefa da Tatiana sem Feito/Pular até o fim do dia: volta amanhã como "pendente de ontem" com
 * prioridade maior; no 2º adiamento, acerto "tarefa atrasada" só na aba do admin.
 */
async function tarefasNaoFeitas(
  db: Db,
  emp: string,
  hoje: string,
  amanha: string,
  horario: HorarioUtil,
): Promise<{ adiadas: number; atrasadas: number }> {
  const { data: vencidas } = await db
    .from("crm_followups")
    .select(
      "id, crm_lead_id, conversa_id, assigned_to, prioridade, adiamentos, scheduled_at, notes, tarefa_tipo",
    )
    .eq("empresa_id", emp)
    .eq("origem", "gerente")
    .eq("responsavel", "equipe")
    .eq("status", "Pendente")
    .lt("scheduled_at", new Date(`${hoje}T00:00:00-03:00`).toISOString())
    .limit(300);
  const saida = { adiadas: 0, atrasadas: 0 };
  for (const t of (vencidas ?? []) as Array<{
    id: string;
    crm_lead_id: string;
    conversa_id: string | null;
    assigned_to: string | null;
    prioridade: number | null;
    adiamentos: number | null;
    scheduled_at: string;
    notes: string | null;
    tarefa_tipo: string | null;
  }>) {
    const a = adiarTarefa({ prioridade: t.prioridade, adiamentos: t.adiamentos ?? 0 });
    const hm = horarioSP(new Date(t.scheduled_at)).hora;
    await db
      .from("crm_followups")
      .update({
        scheduled_at: proximoHorarioUtil(
          new Date(`${amanha}T${hm}:00-03:00`).toISOString(),
          horario,
        ),
        prioridade: a.prioridade,
        adiamentos: a.adiamentos,
        notes: `Pendente de ontem (${a.adiamentos}ª vez). ${t.notes ?? ""}`.slice(0, 500),
      })
      .eq("id", t.id);
    saida.adiadas++;
    if (a.avisarAdmin) {
      const { error } = await db.from("comercial_cobrancas").insert({
        empresa_id: emp,
        crm_lead_id: t.crm_lead_id,
        conversa_id: t.conversa_id,
        user_id: t.assigned_to,
        tipo: "tarefa_atrasada",
        texto: `Tarefa da ${NOME_GERENTE} (${t.tarefa_tipo ?? "mensagem"}) sem Feito nem Pular há 2 dias.`,
        dados: { prioridade: 1, followup_id: t.id },
        visivel_equipe: false,
      });
      if (!error) saida.atrasadas++;
    }
  }
  return saida;
}

// ---------------------------------------------------------------- recados

/** "(2 pós-venda, 1 remarcar, 1 lead do site)" para o recado; vazio quando são só mensagens. */
function resumoPorTipo(tarefas: Array<{ tarefa_tipo: string | null }>, leadsSite: number): string {
  const n = new Map<string, number>();
  for (const t of tarefas) {
    const tipo = t.tarefa_tipo ?? "mensagem";
    if (tipo !== "mensagem") n.set(tipo, (n.get(tipo) ?? 0) + 1);
  }
  if (leadsSite) n.set("lead_site", leadsSite);
  if (!n.size) return "";
  const rotulo: Record<string, string> = {
    ligar: "ligação",
    follow_up_esquecido: "follow-up esquecido",
    remarcar: "remarcar",
    pos_venda: "pós-venda",
    lead_site: "lead do site",
  };
  return ` (${[...n.entries()].map(([k, v]) => `${v} ${rotulo[k] ?? k}`).join(", ")})`;
}

/**
 * Leads do site sem conversa no WhatsApp que viram tarefa no dia `dia` (D+1 e D+3 do cadastro).
 * Sem lead no CRM ainda (nasce na primeira mensagem): a tarefa é virtual, sem crm_followups.
 */
export async function leadsSiteParaTarefa(
  db: Db,
  emp: string,
  dia: string,
): Promise<
  Array<{
    id: string;
    nome: string | null;
    telefone: string | null;
    servico: string | null;
    lp: string | null;
  }>
> {
  const { data } = await db
    .from("leads_site")
    .select("id, nome, telefone, servico, lp, cadastrado_em")
    .eq("empresa_id", emp)
    .eq("situacao", "nao_chamou")
    .is("conversa_id", null)
    .is("crm_lead_id", null)
    .is("repetido_de", null)
    .not("telefone", "is", null)
    .gte("cadastrado_em", `${somarDias(dia, -3)}T00:00:00-03:00`)
    .lt("cadastrado_em", `${dia}T00:00:00-03:00`)
    .order("cadastrado_em")
    .limit(50);
  return (
    (data ?? []) as Array<{
      id: string;
      nome: string | null;
      telefone: string | null;
      servico: string | null;
      lp: string | null;
      cadastrado_em: string;
    }>
  ).filter((l) => {
    const d = horarioSP(new Date(l.cadastrado_em)).data;
    return d === somarDias(dia, -1) || d === somarDias(dia, -3);
  });
}

async function escreverRecados(db: Db, ctx: ContextoNoite) {
  const emp = ctx.noite.empresa_id;
  const dia = ctx.amanha;
  const ontemIni = new Date(`${horarioSP(new Date()).data}T00:00:00-03:00`).toISOString();
  const [{ data: tarefas }, { data: cobr }, { count: vendas }, { data: recentes }] =
    await Promise.all([
      db
        .from("crm_followups")
        .select("assigned_to, motivo, prioridade, tarefa_tipo")
        .eq("empresa_id", emp)
        .eq("origem", "gerente")
        .eq("responsavel", "equipe")
        .eq("status", "Pendente")
        .lte("scheduled_at", new Date(`${dia}T23:59:59-03:00`).toISOString()),
      db
        .from("comercial_cobrancas")
        .select("user_id")
        .eq("empresa_id", emp)
        .eq("situacao", "pendente"),
      db
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", emp)
        .gte("os_criada_em", ontemIni),
      db
        .from("comercial_recados")
        .select("user_id, frase")
        .eq("empresa_id", emp)
        .gte("dia", somarDias(dia, -7)),
    ]);
  const ts = (tarefas ?? []) as Array<{
    assigned_to: string | null;
    motivo: string | null;
    prioridade: number | null;
    tarefa_tipo: string | null;
  }>;
  const leadsSite = (await leadsSiteParaTarefa(db, emp, dia).catch(() => [])).length;
  // Meta do dia e semana da equipe (etapa 3): entram no recado como contexto, sem nomes.
  const { linhaDaMeta, textoSemanaEquipe } = await import("./equipe");
  const linhaMeta = await (async () => {
    const { calcularMes } = await import("./mes.server");
    const m = await calcularMes(db, emp, dia, ctx.horario.dias);
    return linhaDaMeta(
      m.meta,
      m.agenda.vazios.map((d) => d.data),
    );
  })().catch(() => null);
  const linhaSemana = await (async () => {
    const { semanaDaEquipe } = await import("./equipe.server");
    return textoSemanaEquipe(await semanaDaEquipe(db, emp, horarioSP(new Date()).data));
  })().catch(() => null);
  const cs = (cobr ?? []) as Array<{ user_id: string | null }>;
  const rs = (recentes ?? []) as Array<{ user_id: string; frase: string }>;
  let custo = 0;
  // Equipe única: um recado só para a equipe (com os nomes das atendentes), gravado para todos.
  const grupos: Array<{
    para: PessoaEquipe[];
    nome: string;
    admin: boolean;
    minhas: typeof ts;
    acertos: number;
    jaDisse: string[];
  }> = ctx.equipeUnica
    ? [
        {
          para: ctx.pessoas,
          nome: nomesDaEquipe(
            ctx.nomesAtendentes.length
              ? ctx.nomesAtendentes
              : ctx.pessoas.filter((p) => p.papel === "atendente").map((p) => p.nome),
          ),
          admin: false,
          minhas: ts,
          acertos: cs.length,
          jaDisse: [...new Set(rs.map((r) => r.frase))],
        },
      ]
    : ctx.pessoas.map((p) => ({
        para: [p],
        nome: p.nome,
        admin: p.papel === "admin",
        minhas: p.papel === "admin" ? ts : ts.filter((t) => t.assigned_to === p.userId),
        acertos: p.papel === "admin" ? cs.length : cs.filter((c) => c.user_id === p.userId).length,
        jaDisse: rs.filter((r) => r.user_id === p.userId).map((r) => r.frase),
      }));
  for (const [i, g] of grupos.entries()) {
    const { minhas, nome, jaDisse } = g;
    const meusAcertos = g.acertos;
    const fallback = {
      frase: fraseReserva(nome, jaDisse, Date.parse(`${dia}T12:00:00Z`) / 86_400_000 + i),
      resumo:
        `${linhaMeta ? `${linhaMeta} ` : ""}` +
        `${minhas.length ? `${minhas.length} ${minhas.length === 1 ? "tarefa" : "tarefas"} hoje` : "Nenhuma tarefa marcada hoje"}` +
        `${meusAcertos ? ` e ${meusAcertos} ${meusAcertos === 1 ? "acerto" : "acertos"} no app` : ""}.`,
    };
    let recado = fallback;
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const resp = await new Anthropic({ timeout: 60_000, maxRetries: 1 }).messages.create({
        model: MODELO_HAIKU,
        max_tokens: 1_000,
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: ESQUEMA_RECADO as unknown as Record<string, unknown>,
          },
        },
        system: instrucoesRecado(),
        messages: [
          {
            role: "user",
            content: [
              `Pessoa: ${nome || "(sem nome)"}${g.admin ? " (dona/admin: vê a equipe toda)" : ""}${ctx.equipeUnica ? " (equipe única: o recado é para todas)" : ""}.`,
              `Tarefas de hoje: ${minhas.length + leadsSite}${resumoPorTipo(minhas, leadsSite)}. Principais: ${
                minhas
                  .sort((a, b) => (a.prioridade ?? 5) - (b.prioridade ?? 5))
                  .slice(0, 3)
                  .map((t) => t.motivo)
                  .filter(Boolean)
                  .join("; ") || "nenhuma"
              }.`,
              `Acertos no app pendentes: ${meusAcertos}.`,
              `Vendas (OS criadas) ontem na empresa: ${vendas ?? 0}.`,
              `Meta do mês: ${linhaMeta ?? "não informada"}`,
              `Semana da equipe (só como equipe, sem ranking): ${linhaSemana ?? "não informada"}.`,
              `Frases recentes (não repetir): ${jaDisse.join(" | ") || "nenhuma"}.`,
            ].join("\n"),
          },
        ],
      });
      custo += custoUsd(resp.usage, PRECO_HAIKU);
      if (resp.stop_reason === "end_turn") {
        const r = JSON.parse(
          resp.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
        ) as { frase?: string; resumo?: string };
        const frase = (r.frase ?? "").trim().slice(0, 200);
        // Sem nome no cadastro: frase com "@" ou números (cara de e-mail) fica a de reserva.
        if (frase && !jaDisse.includes(frase) && !/@|\d{3}/.test(frase))
          recado = { frase, resumo: (r.resumo ?? fallback.resumo).trim().slice(0, 600) };
      }
    } catch {
      // Fica a frase de reserva.
    }
    for (const p of g.para)
      await db
        .from("comercial_recados")
        .upsert(
          { empresa_id: emp, user_id: p.userId, dia, frase: recado.frase, resumo: recado.resumo },
          { onConflict: "empresa_id,user_id,dia" },
        );
  }
  return custo;
}

// ---------------------------------------------------------------- noite

/** Aviso no sininho (só no app), uma vez por referência. */
async function avisarUmaVez(
  db: Db,
  empresaId: string,
  tipo: string,
  titulo: string,
  mensagem: string,
  referencia: string,
) {
  const { data: ja } = await db
    .from("mkt_avisos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("referencia", referencia)
    .limit(1);
  if (ja?.length) return;
  await db
    .from("mkt_avisos")
    .insert({ empresa_id: empresaId, tipo, titulo, mensagem, so_no_app: true, referencia });
}

async function gastoDoMes(db: Db, empresaId: string, agora: Date): Promise<number> {
  const mes = horarioSP(agora).data.slice(0, 7);
  const { data } = await db
    .from("comercial_noites")
    .select("custo_usd")
    .eq("empresa_id", empresaId)
    .gte("noite", `${mes}-01`);
  return ((data ?? []) as Array<{ custo_usd: number | string }>).reduce(
    (s, n) => s + Number(n.custo_usd ?? 0),
    0,
  );
}

async function contextoDaNoite(db: Db, noite: Noite): Promise<ContextoNoite> {
  const { contextoDaEmpresa } = await import("./analise.server");
  const [ctx, { data: ia }, pessoas, { data: cfg }, bloqueadosMapa] = await Promise.all([
    contextoDaEmpresa(db, noite.empresa_id),
    db.from("ia_configuracoes").select("ativo").eq("empresa_id", noite.empresa_id).maybeSingle(),
    pessoasDaEmpresa(db, noite.empresa_id),
    db
      .from("comercial_configuracoes")
      .select("equipe_unica, dias_uteis, hora_inicio, hora_fim")
      .eq("empresa_id", noite.empresa_id)
      .maybeSingle(),
    // Feriados bloqueados (02/11): tarefa nenhuma cai neles; vai para o próximo dia útil.
    (async () => {
      const { bloqueadosNoPeriodo } = await import("@/lib/feriados.server");
      return bloqueadosNoPeriodo(db, noite.empresa_id, noite.noite, somarDias(noite.noite, 45));
    })(),
  ]);
  // Agenda real dos próximos 30 dias (03/11): os acertos com data em dia bloqueado sugerem os
  // próximos horários livres. Se falhar, segue sem sugestão.
  const agenda = await (async () => {
    const { agendaAteFimDoMes } = await import("./mes.server");
    const a = await agendaAteFimDoMes(
      db,
      noite.empresa_id,
      noite.noite,
      somarDias(noite.noite, 30),
      (cfg as { dias_uteis?: number[] | null } | null)?.dias_uteis ?? [1, 2, 3, 4, 5, 6],
    );
    return a.dias;
  })().catch(() => [] as Array<{ data: string; livres: number; feriado?: string }>);
  const bloqueados = [...bloqueadosMapa.keys()];
  const config = cfg as
    | (Pick<Config, "dias_uteis" | "hora_inicio" | "hora_fim"> & {
        equipe_unica?: boolean;
      })
    | null;
  const { data: vendedoras } = await db
    .from("salespeople")
    .select("name, user_id, eh_ia")
    .eq("empresa_id", noite.empresa_id)
    .eq("active", true);
  const temAlice = Boolean((ia as { ativo?: boolean } | null)?.ativo);
  return {
    noite,
    temAlice,
    pixPct: ctx.pixPct,
    motivos: ctx.motivos,
    pessoas,
    equipeUnica: Boolean(config?.equipe_unica),
    horario: horarioDaConfig(config, bloqueados),
    modoAtivo: noite.modo === "ativo",
    especiais: {
      esquecidos:
        (noite.resumo as { especiais?: EspeciaisDaNoite } | null)?.especiais?.esquecidos ?? {},
    },
    opus: (noite.resumo as { modelo?: string } | null)?.modelo === "opus",
    leituraCompleta: Boolean(
      (noite.resumo as { leituraCompleta?: boolean } | null)?.leituraCompleta,
    ),
    bloqueados: bloqueadosMapa,
    livresDepois: (data: string) =>
      agenda
        .filter((d) => d.data > data && d.livres > 0 && !d.feriado)
        .slice(0, 3)
        .map(
          (d) =>
            `${diaSemanaDe(d.data)} ${dataCurta(d.data)} (${d.livres} ${d.livres === 1 ? "horário" : "horários"})`,
        ),
    nomesAtendentes: (
      (vendedoras ?? []) as Array<{ name: string; user_id: string | null; eh_ia: boolean | null }>
    )
      .filter((v) => v.user_id && !v.eh_ia)
      .map((v) => nomeDaPessoa(v.name)),
    amanha: somarDias(noite.noite, 1),
    sistema: instrucoesDecisao({
      empresa: ctx.empresaNome,
      temAlice,
      motivos: ctx.motivos.map((m) => m.nome),
      pixPct: ctx.pixPct,
    }),
  };
}

/** Uma passada sobre uma noite em andamento (assume a noite, decide uma rodada de leads). */
async function avancarNoite(db: Db, noite: Noite, teto: number): Promise<Record<string, unknown>> {
  const agora = new Date();
  const limite = new Date(agora.getTime() - TRAVA_MS).toISOString();
  const { data: assumida } = await db
    .from("comercial_noites")
    .update({ atualizada_em: agora.toISOString() })
    .eq("id", noite.id)
    .eq("status", "rodando")
    .or(`atualizada_em.is.null,atualizada_em.lt.${limite}`)
    .select("id")
    .maybeSingle();
  if (!assumida) return { noite: noite.id, situacao: "outra passada em andamento" };
  const ctx = await contextoDaNoite(db, noite);
  const inicio = Date.now();
  let feitos = noite.processados;
  let erros = noite.com_erro;
  let custo = Number(noite.custo_usd);
  const gastoAntes =
    noite.modo === "conferencia" ? 0 : await gastoDoMes(db, noite.empresa_id, agora);
  const { podeSeguir } = await import("@/lib/freio.server");
  let primeiraRodada = true;
  while (feitos < noite.leads.length && Date.now() - inicio < TEMPO_DA_PASSADA_MS) {
    // Freio: banco lento (consulta simples acima de 2 s) para a passada; pausa entre rodadas.
    if (!(await podeSeguir(db, primeiraRodada))) break;
    primeiraRodada = false;
    if (noite.modo !== "conferencia" && gastoAntes + (custo - Number(noite.custo_usd)) >= teto) {
      await db
        .from("comercial_noites")
        .update({ status: "parada_teto", custo_usd: custo, processados: feitos, com_erro: erros })
        .eq("id", noite.id);
      return { noite: noite.id, situacao: "parada no teto mensal" };
    }
    const rodada = noite.leads.slice(feitos, feitos + POR_RODADA);
    const rs = await Promise.allSettled(rodada.map((id) => decidirLead(db, ctx, id)));
    for (const r of rs) {
      if (r.status === "fulfilled") custo += r.value;
      else {
        erros++;
        console.error(
          "Tatiana: lead não decidido",
          r.reason instanceof Error ? r.reason.message : String(r.reason),
        );
      }
    }
    feitos += rodada.length;
    await db
      .from("comercial_noites")
      .update({
        processados: feitos,
        com_erro: erros,
        custo_usd: custo,
        resumo: noite.resumo,
        atualizada_em: new Date().toISOString(),
      })
      .eq("id", noite.id);
  }
  if (feitos < noite.leads.length) {
    // Libera para a próxima passada continuar.
    await db.from("comercial_noites").update({ atualizada_em: null }).eq("id", noite.id);
    return { noite: noite.id, feitos, faltam: noite.leads.length - feitos };
  }
  if (noite.modo !== "conferencia") {
    await limitesDaNoite(db, noite).catch((e) =>
      console.error("Tatiana: limites da noite", e instanceof Error ? e.message : String(e)),
    );
    custo += await escreverRecados(db, ctx).catch(() => 0);
  }
  await db
    .from("comercial_noites")
    .update({
      status: "concluida",
      custo_usd: custo,
      resumo: noite.resumo,
      concluida_em: new Date().toISOString(),
    })
    .eq("id", noite.id);
  return { noite: noite.id, situacao: "concluida", custo };
}

/**
 * Fim da noite: SEM limite de tarefas (05/11, decisão do dono: toda tarefa que precisa ser feita é
 * criada e aparece; o que organiza é a prioridade e o prazo). Antes eram até 15 extras por dia e as
 * outras viravam "esperar"; um lead quase fechado (concorrente) chegou a ser cortado.
 */
async function limitesDaNoite(db: Db, noite: Noite) {
  const { count: tarefas } = await db
    .from("comercial_decisoes")
    .select("id", { count: "exact", head: true })
    .eq("noite_id", noite.id)
    .not("followup_id", "is", null);
  const { data: novas } = await db
    .from("comercial_cobrancas")
    .select("id, tipo, dados")
    .eq("noite_id", noite.id)
    .eq("situacao", "pendente");
  const visiveis = cobrancasVisiveis(
    (
      (novas ?? []) as Array<{ id: string; tipo: TipoCobranca; dados: { prioridade?: number } }>
    ).map((c) => ({ id: c.id, tipo: c.tipo, prioridade: Number(c.dados?.prioridade ?? 5) })),
  );
  if (visiveis.length)
    await db.from("comercial_cobrancas").update({ visivel_equipe: true }).in("id", visiveis);
  noite.resumo = {
    ...(noite.resumo ?? {}),
    tarefas: tarefas ?? 0,
    acertosNaLista: visiveis.length,
    acertosSoNaAba: Math.max(0, (novas ?? []).length - visiveis.length),
  };
}

/** Chamada pela varredura do servidor. */
export async function rodarTatiana(agora = new Date()): Promise<Record<string, unknown>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;
  const { data: hoje, hora } = horarioSP(agora);
  const saida: Record<string, unknown> = {};

  // 1. Noites em andamento (inclui a conferência, que roda a qualquer hora).
  const { data: andamento } = await db
    .from("comercial_noites")
    .select(
      "id, empresa_id, noite, modo, leads, processados, com_erro, status, custo_usd, resumo, atualizada_em",
    )
    .eq("status", "rodando")
    .order("iniciada_em")
    .limit(2);
  const { data: cfgs } = await db
    .from("comercial_configuracoes")
    .select(
      "empresa_id, modo, equipe_unica, teto_mensal_usd, hora_noite, alerta_teto_mes, dias_uteis, hora_inicio, hora_fim, modelo",
    )
    .eq("ligado", true);
  const configs = (cfgs ?? []) as Config[];
  for (const n of (andamento ?? []) as Noite[]) {
    const cfg = configs.find((c) => c.empresa_id === n.empresa_id);
    saida[`noite_${n.empresa_id.slice(0, 8)}`] = await avancarNoite(
      db,
      n,
      Number(cfg?.teto_mensal_usd ?? 10),
    ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
  }

  for (const cfg of configs) {
    if (cfg.modo === "desligado") continue;
    const emp = cfg.empresa_id;
    const teto = Number(cfg.teto_mensal_usd);
    // 2. Começa a noite na hora marcada (uma por dia).
    if (hora >= cfg.hora_noite.slice(0, 5) && hora < "23:30") {
      const { data: ja } = await db
        .from("comercial_noites")
        .select("id")
        .eq("empresa_id", emp)
        .eq("noite", hoje)
        .eq("modo", cfg.modo)
        .maybeSingle();
      if (!ja) {
        const gasto = await gastoDoMes(db, emp, agora);
        if (gasto >= teto) {
          saida[`teto_${emp.slice(0, 8)}`] = gasto;
        } else {
          const { diasBloqueadosLista } = await import("@/lib/feriados.server");
          const horario = horarioDaConfig(cfg, await diasBloqueadosLista(db, emp, hoje, 45));
          const amanha = somarDias(hoje, 1);
          // Antes de montar a lista: tarefas de ontem que ninguém fez e as tarefas sem IA.
          const naoFeitas = await tarefasNaoFeitas(db, emp, hoje, amanha, horario).catch((e) => ({
            erro: e instanceof Error ? e.message : String(e),
          }));
          const { data: ultima } = await db
            .from("comercial_noites")
            .select("iniciada_em")
            .eq("empresa_id", emp)
            .neq("modo", "conferencia")
            .order("iniciada_em", { ascending: false })
            .limit(1)
            .maybeSingle();
          const desde = desdeAUltimaPassada(
            (ultima as { iniciada_em?: string } | null)?.iniciada_em ?? null,
            agora,
          );
          const diretas = await tarefasDiretas(
            db,
            { emp, hoje, amanha, horario, equipeUnica: Boolean(cfg.equipe_unica) },
            await pessoasDaEmpresa(db, emp),
            desde,
          ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
          // Voltar na conversa (05/11): a equipe entrou no meio da sequência da Alice.
          const voltarConversa = await (async () => {
            const { tarefasVoltarConversa } = await import("./voltar-conversa.server");
            return tarefasVoltarConversa(db, {
              emp,
              quando: proximoHorarioUtil(
                new Date(`${amanha}T09:00:00-03:00`).toISOString(),
                horario,
              ),
              agora,
            });
          })().catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
          const completo = usaLeituraCompleta(cfg.modelo);
          const escopo = await escopoDaNoite(db, emp, agora, hoje, completo);
          const leads = escopo.ids;
          await db.from("comercial_noites").insert({
            empresa_id: emp,
            noite: hoje,
            modo: cfg.modo,
            leads,
            status: leads.length ? "rodando" : "concluida",
            concluida_em: leads.length ? null : agora.toISOString(),
            resumo: {
              entrada: escopo.entrada,
              ...(completo ? { leituraCompleta: true, modelo: "opus" } : {}),
              diretas,
              voltarConversa,
              naoFeitas,
              especiais: escopo.especiais,
            },
          });
          saida[`nova_${emp.slice(0, 8)}`] = { leads: leads.length, ...escopo.entrada };
        }
      }
    }
    // 3. Aviso de 80% do teto mensal (uma vez por mês, só no app, para o admin).
    const mes = hoje.slice(0, 7);
    if (cfg.alerta_teto_mes !== mes) {
      const gasto = await gastoDoMes(db, emp, agora);
      if (teto > 0 && gasto >= 0.8 * teto) {
        await avisarUmaVez(
          db,
          emp,
          "gerente_teto",
          `${NOME_GERENTE}: 80% do teto do mês`,
          `A ${NOME_GERENTE} já usou US$ ${gasto.toFixed(2)} de US$ ${teto.toFixed(2)} neste mês. Ao chegar no teto, ela para até o mês que vem.`,
          `gerente_teto:${mes}`,
        );
        await db
          .from("comercial_configuracoes")
          .update({ alerta_teto_mes: mes })
          .eq("empresa_id", emp);
      }
    }
    // 4. Rede de segurança (modo ativo): sem noite concluída até as 7h, vale a cadência padrão.
    if (cfg.modo === "ativo" && hora >= "07:00" && hora < "07:30") {
      const ontem = somarDias(hoje, -1);
      const { data: n } = await db
        .from("comercial_noites")
        .select("status")
        .eq("empresa_id", emp)
        .eq("noite", ontem)
        .eq("modo", "ativo")
        .maybeSingle();
      if ((n as { status?: string } | null)?.status !== "concluida") {
        await avisarUmaVez(
          db,
          emp,
          "gerente_sem_noite",
          `${NOME_GERENTE} não terminou a noite`,
          `A passada de ontem da ${NOME_GERENTE} não terminou; hoje vale a cadência padrão de follow-up.`,
          `gerente_sem_noite:${hoje}`,
        );
      }
    }
  }

  // 4b. Revisão semanal (domingo à noite): lote com os leads da semana e os avisos da equipe.
  const { pedirRevisoesSemanais } = await import("./revisao-semanal.server");
  saida["revisao_semanal"] = await pedirRevisoesSemanais(
    db,
    configs.filter((c) => c.modo !== "desligado").map((c) => c.empresa_id),
    agora,
    hoje,
    hora,
  ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));

  // 4b2. Base parada (04/11): na janela da revisão semanal, um recado por empresa só para o admin.
  {
    const { horaDaRevisao } = await import("./revisao-semanal");
    const diaSemana = new Date(`${hoje}T12:00:00Z`).getUTCDay();
    if (horaDaRevisao(diaSemana, hora, hoje)) {
      const { rodarBasesParadas } = await import("./base-parada.server");
      saida["base_parada"] = await rodarBasesParadas(
        db,
        configs.filter((c) => c.modo !== "desligado").map((c) => c.empresa_id),
        agora,
        hoje,
      ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
      // 4b3. O que a Alice não soube (05/11): só quando a base parada não leu nada nesta passada.
      if (!Object.keys(saida["base_parada"] as object).length) {
        const { rodarNaoSoube } = await import("./alice-nao-soube.server");
        saida["alice_nao_soube"] = await rodarNaoSoube(
          db,
          configs.filter((c) => c.modo !== "desligado").map((c) => c.empresa_id),
          agora,
          hoje,
        ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
      }
    }
  }

  // 4c. Desempenho de campanha (22h): números dos 7 dias, classe das respostas e sugestões.
  const { rodarAcompanhamentoCampanhas } = await import("./campanhas.server");
  const campanhas = await rodarAcompanhamentoCampanhas(
    db,
    configs.filter((c) => c.modo !== "desligado").map((c) => c.empresa_id),
    agora,
    hoje,
    hora,
  ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
  if (Object.keys(campanhas).length) saida["campanhas"] = campanhas;

  // 4d. Gerente do mês (8h): alertas do dia para o admin (aviso no app + push), uma vez por chave.
  const { rodarMesDaTatiana } = await import("./mes.server");
  const mesSaida = await rodarMesDaTatiana(
    db,
    configs
      .filter((c) => c.modo !== "desligado")
      .map((c) => ({ empresa_id: c.empresa_id, dias_uteis: c.dias_uteis ?? null })),
    hoje,
    hora,
  ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
  if (Object.keys(mesSaida).length) saida["mes"] = mesSaida;

  // 4e. Plano de ação do dia (8h20): 1–3 ações para o admin aprovar (rascunho no Marketing).
  const { rodarPlanoDaTatiana } = await import("./plano.server");
  const planoSaida = await rodarPlanoDaTatiana(
    db,
    configs
      .filter((c) => c.modo !== "desligado")
      .map((c) => ({ empresa_id: c.empresa_id, dias_uteis: c.dias_uteis ?? null })),
    hoje,
    hora,
  ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
  if (Object.keys(planoSaida).length) saida["plano"] = planoSaida;

  // 4f. Feriados (8h–20h): calendário semeado, pergunta "vamos trabalhar?", lembrete, padrão na
  // véspera e tarefas "remarcar" dos atendimentos marcados em feriado bloqueado.
  const { rodarFeriadosDaTatiana } = await import("@/lib/feriados.server");
  const feriadosSaida = await rodarFeriadosDaTatiana(
    db,
    configs
      .filter((c) => c.modo !== "desligado")
      .map((c) => ({ empresa_id: c.empresa_id, dias_uteis: c.dias_uteis ?? null })),
    hoje,
    hora,
  ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
  if (Object.keys(feriadosSaida).length) saida["feriados"] = feriadosSaida;

  // 5. Pushes.
  saida["pushes"] = await pushesDaTatiana(db, configs, agora).catch((e) => ({
    erro: e instanceof Error ? e.message : String(e),
  }));
  return saida;
}

// ---------------------------------------------------------------- pushes

async function pushesDaTatiana(db: Db, configs: Config[], agora: Date) {
  const { data: hoje, hora } = horarioSP(agora);
  const manha = hora >= "08:00" && hora < "10:00";
  const dez = hora >= "10:00" && hora < "10:30";
  const noiteAdmin = hora >= "21:45" && hora < "23:30";
  if (!manha && !dez && !noiteAdmin) return { enviados: 0 };
  const { pessoasComCelular, enviarParaPessoa, registrarUmaVez } =
    await import("@/lib/push/notificacoes.server");
  const { querReceber } = await import("@/lib/push/notificacoes");
  let enviados = 0;
  for (const cfg of configs) {
    if (cfg.modo === "desligado") continue;
    const emp = cfg.empresa_id;
    const pessoas = (await pessoasComCelular(db as never, emp)).get(emp) ?? [];
    if (!pessoas.length) continue;
    if (manha) {
      const { data: ts } = await db
        .from("crm_followups")
        .select("assigned_to")
        .eq("empresa_id", emp)
        .eq("origem", "gerente")
        .eq("status", "Pendente")
        .lte("scheduled_at", new Date(`${hoje}T23:59:59-03:00`).toISOString());
      const lista = (ts ?? []) as Array<{ assigned_to: string | null }>;
      const { data: recs } = await db
        .from("comercial_recados")
        .select("user_id, frase")
        .eq("empresa_id", emp)
        .eq("dia", hoje);
      for (const p of pessoas) {
        if (!querReceber("tatiana_tarefas", p.papel, p.pref)) continue;
        // Equipe única: as atendentes recebem o total da equipe.
        const n =
          p.papel === "admin" || cfg.equipe_unica
            ? lista.length
            : lista.filter((t) => t.assigned_to === p.userId).length;
        if (!n) continue;
        const frase =
          ((recs ?? []) as Array<{ user_id: string; frase: string }>).find(
            (r) => r.user_id === p.userId,
          )?.frase ?? null;
        const t = textoPushTarefas(n, frase, Boolean(cfg.equipe_unica) && p.papel !== "admin");
        if (n > LISTA_GRANDE)
          t.corpo = `Lista grande hoje (${n} tarefas): comece pelas de prioridade alta. ${t.corpo}`;
        const id = await registrarUmaVez(
          db as never,
          emp,
          p.userId,
          "tatiana_tarefas",
          hoje,
          t.titulo,
        );
        if (!id) continue;
        const r = await enviarParaPessoa(db as never, p.celulares, {
          titulo: t.titulo,
          corpo: t.corpo,
          url: "/crm/follow-ups",
          tag: `tatiana-${hoje}`,
        });
        enviados += r.enviados;
      }
      // Feito pela Tatiana (03/11): o que ela fez (ou faria, em teste) desde ontem à noite.
      // Só para o admin, no app e por push; cada item tem Desfazer em Follow-ups.
      if (cfg.modo === "ativo" || cfg.modo === "teste") {
        const { acoesDesde } = await import("./acoes.server");
        const feitas = (
          await acoesDesde(db, emp, new Date(`${somarDias(hoje, -1)}T18:00:00-03:00`).toISOString())
        ).filter((a) => a.situacao === (cfg.modo === "ativo" ? "feita" : "faria"));
        if (feitas.length) {
          const t = textoFeitoPelaTatiana(feitas, cfg.modo);
          await avisarUmaVez(db, emp, "gerente_feito", t.titulo, t.corpo, `gerente_feito:${hoje}`);
          for (const p of pessoas) {
            if (p.papel !== "admin" || !querReceber("alerta_gerente", p.papel, p.pref)) continue;
            const id = await registrarUmaVez(
              db as never,
              emp,
              p.userId,
              "alerta_gerente",
              `feito:${hoje}`,
              t.titulo,
            );
            if (!id) continue;
            const r = await enviarParaPessoa(db as never, p.celulares, {
              titulo: t.titulo,
              corpo: t.corpo,
              url: "/crm/follow-ups",
              tag: `tatiana-feito-${hoje}`,
            });
            enviados += r.enviados;
          }
        }
      }
    }
    if (dez) {
      // Item 15: quem tem tarefa hoje e está sem push ativo ou não abriu o app → aviso ao admin.
      const { data: ts } = await db
        .from("crm_followups")
        .select("assigned_to")
        .eq("empresa_id", emp)
        .eq("origem", "gerente")
        .eq("responsavel", "equipe")
        .eq("status", "Pendente")
        .lte("scheduled_at", new Date(`${hoje}T23:59:59-03:00`).toISOString());
      const comTarefa = [
        ...new Set(
          ((ts ?? []) as Array<{ assigned_to: string | null }>)
            .map((t) => t.assigned_to)
            .filter(Boolean) as string[],
        ),
      ];
      const alvo = cfg.equipe_unica
        ? (await pessoasDaEmpresa(db, emp)).filter((p) => p.papel !== "admin").map((p) => p.userId)
        : comTarefa;
      if (alvo.length) {
        const { data: leituras } = await db
          .from("conversas_leituras")
          .select("user_id")
          .eq("empresa_id", emp)
          .in("user_id", alvo)
          .gte("lida_em", new Date(`${hoje}T00:00:00-03:00`).toISOString())
          .limit(500);
        const abriu = new Set(
          ((leituras ?? []) as Array<{ user_id: string }>).map((l) => l.user_id),
        );
        const comPush = new Set(pessoas.map((p) => p.userId));
        const sem = alvo.filter((u) => !comPush.has(u) && !abriu.has(u));
        if (sem.length) {
          const nomes = new Map((await pessoasDaEmpresa(db, emp)).map((p) => [p.userId, p.nome]));
          const lista = sem.map((u) => nomes.get(u) || "alguém da equipe").join(", ");
          const titulo = `${NOME_GERENTE}: ${lista} sem notificação`;
          const corpo = `${lista} ${sem.length === 1 ? "tem" : "têm"} tarefa hoje, mas ${sem.length === 1 ? "está" : "estão"} sem push ativo e ${sem.length === 1 ? "não abriu" : "não abriram"} o app. Vale avisar por outro canal.`;
          await avisarUmaVez(db, emp, "equipe_sem_push", titulo, corpo, `equipe_sem_push:${hoje}`);
          for (const p of pessoas) {
            if (p.papel !== "admin" || !querReceber("equipe_sem_push", p.papel, p.pref)) continue;
            const id = await registrarUmaVez(
              db as never,
              emp,
              p.userId,
              "equipe_sem_push",
              hoje,
              titulo,
            );
            if (!id) continue;
            const r = await enviarParaPessoa(db as never, p.celulares, {
              titulo,
              corpo,
              url: "/gerente-comercial",
              tag: `equipe-sem-push-${hoje}`,
            });
            enviados += r.enviados;
          }
        }
      }
    }
    if (noiteAdmin) {
      const { data: noite } = await db
        .from("comercial_noites")
        .select("status")
        .eq("empresa_id", emp)
        .eq("noite", hoje)
        .neq("modo", "conferencia")
        .maybeSingle();
      if ((noite as { status?: string } | null)?.status !== "concluida") continue;
      const iniHoje = new Date(`${hoje}T00:00:00-03:00`).toISOString();
      const [{ count: criadas }, { count: resolvidas }, { count: pendentes }, { data: e }] =
        await Promise.all([
          db
            .from("comercial_cobrancas")
            .select("id", { count: "exact", head: true })
            .eq("empresa_id", emp)
            .gte("criada_em", iniHoje),
          db
            .from("comercial_cobrancas")
            .select("id", { count: "exact", head: true })
            .eq("empresa_id", emp)
            .gte("resolvida_em", iniHoje),
          db
            .from("comercial_cobrancas")
            .select("id", { count: "exact", head: true })
            .eq("empresa_id", emp)
            .eq("situacao", "pendente"),
          db.from("empresas").select("nome").eq("id", emp).maybeSingle(),
        ]);
      const t = textoPushCobrancas({
        empresa: (e as { nome?: string } | null)?.nome ?? "Empresa",
        total: criadas ?? 0,
        resolvidas: resolvidas ?? 0,
        pendentes: pendentes ?? 0,
      });
      for (const p of pessoas) {
        if (p.papel !== "admin" || !querReceber("tatiana_cobrancas", p.papel, p.pref)) continue;
        const id = await registrarUmaVez(
          db as never,
          emp,
          p.userId,
          "tatiana_cobrancas",
          hoje,
          t.titulo,
        );
        if (!id) continue;
        const r = await enviarParaPessoa(db as never, p.celulares, {
          titulo: t.titulo,
          corpo: t.corpo,
          url: "/gerente-comercial?aba=cobrancas",
          tag: `tatiana-cobrancas-${hoje}`,
        });
        enviados += r.enviados;
      }
    }
  }
  return { enviados };
}

/** Conferência pontual (ex.: Ecoprime desde 28/10): só conta os acertos, sem nada visível. */
export async function pedirConferencia(
  db: Db,
  empresaId: string,
  desde: string,
): Promise<{ id: string; leads: number }> {
  const { data: convs } = await db
    .from("conversas")
    .select("crm_lead_id")
    .eq("empresa_id", empresaId)
    .not("crm_lead_id", "is", null)
    .gte("ultima_atividade_em", desde)
    .limit(2000);
  const leads = [
    ...new Set(((convs ?? []) as Array<{ crm_lead_id: string }>).map((c) => c.crm_lead_id)),
  ];
  const { data, error } = await db
    .from("comercial_noites")
    .insert({
      empresa_id: empresaId,
      noite: horarioSP(new Date()).data,
      modo: "conferencia",
      leads,
      status: leads.length ? "rodando" : "concluida",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`conferência: ${error?.message ?? "sem retorno"}`);
  return { id: (data as { id: string }).id, leads: leads.length };
}
