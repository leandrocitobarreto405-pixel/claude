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
import { calcularFatos, conversaEmTexto } from "./fatos";
import { MODELO_FICHA, MODELO_HAIKU, PRECO_HAIKU, custoUsd } from "./ficha";
import {
  ESQUEMA_DECISAO,
  ESQUEMA_RECADO,
  NOME_GERENTE,
  LIMITE_TAREFAS_DIA,
  aplicarTravas,
  cobrancasVisiveis,
  demorasDaEquipe,
  desdeAUltimaPassada,
  entraNaNoite,
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

async function leadsDaNoite(db: Db, empresaId: string, agora: Date): Promise<string[]> {
  // Mensagem nova = do cliente, desde o começo da última passada (sem passada: últimas 24 h).
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
  const ate2dias = new Date(agora.getTime() + 2 * 86_400_000).toISOString();
  const [{ data: msgs }, { data: toques }, { data: orcs }] = await Promise.all([
    db
      .from("whatsapp_messages")
      .select("crm_lead_id")
      .eq("empresa_id", empresaId)
      .eq("direction", "Recebida")
      .eq("privada", false)
      .not("crm_lead_id", "is", null)
      .gte("message_timestamp", desde)
      .limit(5000),
    // Toque marcado nos próximos 2 dias (os atrasados não contam).
    db
      .from("crm_followups")
      .select("crm_lead_id")
      .eq("empresa_id", empresaId)
      .eq("status", "Pendente")
      .gte("scheduled_at", agora.toISOString())
      .lte("scheduled_at", ate2dias)
      .limit(2000),
    db
      .from("crm_leads")
      .select("id")
      .eq("empresa_id", empresaId)
      .gte("orcamento_enviado_em", desde)
      .limit(2000),
  ]);
  const escreveu = new Set(
    ((msgs ?? []) as Array<{ crm_lead_id: string }>).map((m) => m.crm_lead_id),
  );
  const comToque = new Set(
    ((toques ?? []) as Array<{ crm_lead_id: string | null }>)
      .map((t) => t.crm_lead_id)
      .filter(Boolean) as string[],
  );
  const orcamentoNovo = new Set(((orcs ?? []) as Array<{ id: string }>).map((o) => o.id));
  const ids = [...new Set([...escreveu, ...comToque, ...orcamentoNovo])];
  if (!ids.length) return [];
  const saida: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const parte = ids.slice(i, i + 200);
    const { data: leads } = await db
      .from("crm_leads")
      .select("id, is_open, perdido_em, linked_work_order_id")
      .eq("empresa_id", empresaId)
      .in("id", parte);
    for (const l of (leads ?? []) as Array<{
      id: string;
      is_open: boolean | null;
      perdido_em: string | null;
      linked_work_order_id: string | null;
    }>) {
      // Lead com OS também entra (acertos de visita e pagamento), se tiver novidade.
      const aberto = !l.perdido_em && (l.is_open !== false || Boolean(l.linked_work_order_id));
      if (
        entraNaNoite({
          aberto,
          clienteEscreveu: escreveu.has(l.id),
          orcamentoNovo: orcamentoNovo.has(l.id),
          toqueEmAte2Dias: comToque.has(l.id),
        })
      )
        saida.push(l.id);
    }
  }
  return saida;
}

// ---------------------------------------------------------------- estado do lead no app

type EstadoLead = {
  texto: string;
  estado: EstadoApp;
  temOs: boolean;
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
  let clienteId = (lead["customer_id"] as string | null) ?? null;
  if (!clienteId && os) {
    const { data: w } = await db
      .from("work_orders")
      .select("customer_id")
      .eq("id", os)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    clienteId = (w as { customer_id?: string | null } | null)?.customer_id ?? null;
  }
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
      .select("numero, status, total, created_at")
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
      .select("id")
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
  const qs = (quotes ?? []) as Array<{
    numero: number | null;
    status: string;
    total: number | null;
    created_at: string;
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
      // Qualquer pagamento ativo lançado na OS conta (pago, a receber ou parcial).
      pagamentoLancado: ps.length > 0,
    },
    temOs: Boolean(os),
    aberto: lead["is_open"] !== false && !lead["perdido_em"],
    anuncio: Boolean(lead["gclid"] || lead["gbraid"] || lead["lp_origem"]),
    conversaId: (conv as { id?: string } | null)?.id ?? null,
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
): Promise<{ decisao: DecisaoIA; custo: number }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { chamarIa } = await import("@/lib/alice/parada-ia.server");
  const resp = await chamarIa(() =>
    new Anthropic({ timeout: 90_000, maxRetries: 1 }).messages.create({
      model: MODELO_HAIKU,
      max_tokens: 4_000,
      output_config: {
        effort: "low",
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
  return { decisao: JSON.parse(texto) as DecisaoIA, custo: custoUsd(resp.usage, PRECO_HAIKU) };
}

/** Mensagem da equipe (negociação ou toque humano) reescrita pelo Sonnet, para ficar no roteiro. */
async function melhorarMensagem(
  conversa: string,
  motivo: string,
  rascunho: string,
  pixPct: number | null,
): Promise<{ mensagem: string; custo: number }> {
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
        "Cite algo específico da conversa; empatia primeiro se o cliente contou um problema; traga algo novo e útil (um horário, um resumo para quem decide, um cuidado); termine com UMA pergunta fácil.",
        `Ao falar de preço, cite o valor no Pix${pixPct ? ` (${String(pixPct).replace(".", ",")}% de desconto)` : ""}. Nunca invente desconto, prazo ou horário que não estejam na conversa.`,
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
  if (resp.stop_reason !== "end_turn") return { mensagem: rascunho, custo: custoUsd(resp.usage) };
  const texto = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const m = (JSON.parse(texto) as { mensagem?: string }).mensagem?.trim();
  return { mensagem: m || rascunho, custo: custoUsd(resp.usage) };
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
  );
  let custo = c1;

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
  // Acertos (31/10): só de conversa com o cliente nos últimos 7 dias; cadastro só o do sistema (OS
  // agendada sem endereço ou CEP); pagamento só com OS; o que o app já mostra certo não entra.
  const conversaRecente =
    est.ultimaDoCliente !== null && Date.now() - Date.parse(est.ultimaDoCliente) <= 7 * 86_400_000;
  const acertos: Array<{ tipo: TipoCobranca; texto: string; dados: Record<string, unknown> }> = [
    ...(conversaRecente ? decisao.acertos : [])
      .filter((a) => a.tipo !== "cadastro")
      .filter((a) => !(a.tipo === "orcamento_sem_app" && est.estado.orcamentos.length))
      .filter((a) => !(a.tipo === "fechou_sem_os" && est.temOs))
      .filter((a) => !(a.tipo === "pagamento" && (!est.temOs || est.estado.pagamentoLancado)))
      .map((a) => ({
        tipo: a.tipo as TipoCobranca,
        texto: a.texto.slice(0, 400),
        dados: { itens: a.itens, prioridade: decisao.prioridade },
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

  // Conferência: só conta (por tipo e por pessoa), nada visível.
  if (noite.modo === "conferencia") {
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
  const responsavel: "alice" | "equipe" =
    !ctx.temAlice || decisao.negociacao ? "equipe" : decisao.responsavel;
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
  const quando =
    quandoParaIso(decisao.quando) ??
    (decisao.acao === "chamar" ? new Date(`${ctx.amanha}T09:00:00-03:00`).toISOString() : null);
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
        etapa: "G1",
        canal: "equipe",
        origem: "gerente",
        mensagem: mensagem.slice(0, 1000) || null,
        motivo: decisao.motivo.slice(0, 300) || null,
        prioridade: decisao.prioridade,
        notes: `${NOME_GERENTE}: ${decisao.motivo}`.slice(0, 500),
      })
      .select("id")
      .single();
    followupId = (fu as { id: string } | null)?.id ?? null;
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
      // No teste, a ação da Alice não é executada (a cadência padrão segue valendo).
      executada: Boolean(followupId),
      modelo: MODELO_HAIKU,
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
  for (const a of acertos) {
    if (jaTem.has(a.tipo)) continue;
    jaTem.add(a.tipo);
    const { error } = await db.from("comercial_cobrancas").insert({
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
    });
    // Já existe uma pendente do mesmo tipo para o lead: fica a que está.
    if (error && error.code !== "23505") throw new Error(`cobrança: ${error.message}`);
  }
  return custo;
}

// ---------------------------------------------------------------- recados

async function escreverRecados(db: Db, ctx: ContextoNoite) {
  const emp = ctx.noite.empresa_id;
  const dia = ctx.amanha;
  const ontemIni = new Date(`${horarioSP(new Date()).data}T00:00:00-03:00`).toISOString();
  const [{ data: tarefas }, { data: cobr }, { count: vendas }, { data: recentes }] =
    await Promise.all([
      db
        .from("crm_followups")
        .select("assigned_to, motivo, prioridade")
        .eq("empresa_id", emp)
        .eq("origem", "gerente")
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
  }>;
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
              `Tarefas de hoje: ${minhas.length}. Principais: ${
                minhas
                  .sort((a, b) => (a.prioridade ?? 5) - (b.prioridade ?? 5))
                  .slice(0, 3)
                  .map((t) => t.motivo)
                  .filter(Boolean)
                  .join("; ") || "nenhuma"
              }.`,
              `Acertos no app pendentes: ${meusAcertos}.`,
              `Vendas (OS criadas) ontem na empresa: ${vendas ?? 0}.`,
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
  const [ctx, { data: ia }, pessoas, { data: cfg }] = await Promise.all([
    contextoDaEmpresa(db, noite.empresa_id),
    db.from("ia_configuracoes").select("ativo").eq("empresa_id", noite.empresa_id).maybeSingle(),
    pessoasDaEmpresa(db, noite.empresa_id),
    db
      .from("comercial_configuracoes")
      .select("equipe_unica")
      .eq("empresa_id", noite.empresa_id)
      .maybeSingle(),
  ]);
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
    equipeUnica: Boolean((cfg as { equipe_unica?: boolean } | null)?.equipe_unica),
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
 * Fim da noite (31/10): até LIMITE_TAREFAS_DIA tarefas novas por empresa (as de maior prioridade;
 * as outras são canceladas e a decisão vira "esperar") e até 10 acertos novos na lista da equipe.
 */
async function limitesDaNoite(db: Db, noite: Noite) {
  const { data: decs } = await db
    .from("comercial_decisoes")
    .select("id, followup_id, motivo")
    .eq("noite_id", noite.id)
    .not("followup_id", "is", null);
  const ds = (decs ?? []) as Array<{ id: string; followup_id: string; motivo: string | null }>;
  const prioridade = new Map<string, number>();
  for (let i = 0; i < ds.length; i += 200) {
    const { data: fus } = await db
      .from("crm_followups")
      .select("id, prioridade")
      .in(
        "id",
        ds.slice(i, i + 200).map((d) => d.followup_id),
      );
    for (const f of (fus ?? []) as Array<{ id: string; prioridade: number | null }>)
      prioridade.set(f.id, f.prioridade ?? 5);
  }
  const lista = [...ds].sort(
    (a, b) => (prioridade.get(a.followup_id) ?? 5) - (prioridade.get(b.followup_id) ?? 5),
  );
  const sobra = lista.slice(LIMITE_TAREFAS_DIA);
  if (sobra.length) {
    await db
      .from("crm_followups")
      .update({ status: "Cancelada", notes: `${NOME_GERENTE}: limite do dia (esperar)` })
      .in(
        "id",
        sobra.map((d) => d.followup_id),
      )
      .eq("status", "Pendente");
    for (const d of sobra)
      await db
        .from("comercial_decisoes")
        .update({
          acao: "esperar",
          executada: false,
          followup_id: null,
          motivo: `limite do dia · ${d.motivo ?? ""}`.slice(0, 300),
        })
        .eq("id", d.id);
  }
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
    tarefasNoLimite: Math.min(lista.length, LIMITE_TAREFAS_DIA),
    tarefasEsperar: sobra.length,
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
    .select("empresa_id, modo, equipe_unica, teto_mensal_usd, hora_noite, alerta_teto_mes")
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
          const leads = await leadsDaNoite(db, emp, agora);
          await db.from("comercial_noites").insert({
            empresa_id: emp,
            noite: hoje,
            modo: cfg.modo,
            leads,
            status: leads.length ? "rodando" : "concluida",
            concluida_em: leads.length ? null : agora.toISOString(),
          });
          saida[`nova_${emp.slice(0, 8)}`] = leads.length;
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
  const noiteAdmin = hora >= "21:45" && hora < "23:30";
  if (!manha && !noiteAdmin) return { enviados: 0 };
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
