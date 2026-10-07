/**
 * Agendamento feito pela Alice: reserva o horário criando a OS (como a Nova OS faz), gera o
 * documento da OS no Google Docs (enviado ao cliente em PDF) e avisa a equipe.
 * Usa a chave de serviço: toda consulta e gravação leva o filtro/valor da empresa da tarefa.
 */
import { z } from "zod";
import { buildFullAddress } from "@/lib/format";
import { defaultCollectionRule } from "@/lib/collection";
import { executarNaEmpresa } from "@/lib/request-db.server";
import {
  ORIGEM_WHATSAPP,
  avisoAgendamento,
  diaCurto,
  ecoAutomatico,
  escolherOrigem,
  escolherVendedora,
  proximoNumeroOS,
  textoPagamento,
  valoresDaReserva,
  visitasDosOrcamentos,
  type OrcamentoReserva,
  type Participacao,
  type ServicoOrcamento,
  type Vendedora,
} from "./agendamento";
import type { ContextoFerramenta } from "./ferramentas.server";

type Ctx = ContextoFerramenta;

// ---------------------------------------------------------------- agenda
export async function carregarAgenda(ctx: Ctx, inicio: string, ate: string) {
  const [{ data: base, error: e1 }, { data: visitas, error: e2 }] = await Promise.all([
    ctx.admin
      .from("agenda_horarios_base")
      .select("tecnico_id, dia_semana, hora, technicians!inner(name, active)")
      .eq("empresa_id", ctx.empresaId)
      .eq("technicians.active", true),
    ctx.admin
      .from("visits")
      .select(
        "scheduled_date, scheduled_time, status, technician_id, work_order:work_order_id(customer:customer_id(latitude, longitude))",
      )
      .eq("empresa_id", ctx.empresaId)
      .gte("scheduled_date", inicio)
      .lte("scheduled_date", ate),
  ]);
  if (e1 || e2) return { erro: (e1 ?? e2)!.message } as const;
  const horarios = (base ?? []).map((b) => ({
    tecnicoId: b.tecnico_id as string,
    tecnico: (b as unknown as { technicians: { name: string } }).technicians.name,
    diaSemana: b.dia_semana as number,
    hora: String(b.hora).slice(0, 5),
  }));
  type Visita = {
    scheduled_date: string;
    scheduled_time: string | null;
    status: string;
    technician_id: string | null;
    work_order: { customer: { latitude: number | null; longitude: number | null } | null } | null;
  };
  const ocupacoes = ((visitas ?? []) as unknown as Visita[])
    .filter((v) => v.scheduled_time)
    .map((v) => {
      const c = v.work_order?.customer;
      return {
        data: v.scheduled_date,
        hora: String(v.scheduled_time).slice(0, 5),
        status: v.status,
        tecnicoId: v.technician_id,
        coords:
          c && c.latitude !== null && c.longitude !== null
            ? { lat: Number(c.latitude), lon: Number(c.longitude) }
            : null,
      };
    });
  return { horarios, ocupacoes } as const;
}

export function agoraSP() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
}

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// ---------------------------------------------------------------- entrada
export const ReservarHorario = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
  tecnico: z.string().trim().max(80).optional(),
  orcamentos: z.array(z.string().trim().min(4).max(40)).max(4).optional(),
  pagamento: z.enum(["pix", "cartao"]),
  parcelas: z.number().int().min(1).max(24).optional(),
  nome_completo: z.string().trim().min(3).max(120),
  cpf_cnpj: z.string().trim().max(20).optional(),
  email: z.string().trim().max(120).optional(),
  cep: z.string().trim().min(8).max(10),
  rua: z.string().trim().max(160).optional(),
  numero: z.string().trim().min(1).max(20),
  complemento: z.string().trim().max(80).optional(),
  bairro: z.string().trim().max(80).optional(),
  cidade: z.string().trim().max(80).optional(),
  uf: z.string().trim().max(2).optional(),
  ponto_referencia: z.string().trim().max(160).optional(),
  observacoes: z.string().trim().max(500).optional(),
});
export type ReservarHorarioInput = z.infer<typeof ReservarHorario>;

type Resultado = { erro: boolean; texto: string };

// ---------------------------------------------------------------- leituras
async function lerLeadCompleto(ctx: Ctx) {
  if (!ctx.leadId) return null;
  const { data } = await ctx.admin
    .from("crm_leads")
    .select(
      "id, lead_name, phone, status_id, customer_id, salesperson_id, sales_origin_id, linked_work_order_id",
    )
    .eq("id", ctx.leadId)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  return data;
}

async function telefoneDaConversa(ctx: Ctx): Promise<string | null> {
  if (!ctx.contatoId) return null;
  const { data } = await ctx.admin
    .from("whatsapp_contacts")
    .select("normalized_phone")
    .eq("id", ctx.contatoId)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  return data?.normalized_phone ?? null;
}

/** Orçamentos pedidos (pelo nº que a Alice recebeu) ou o mais recente do lead. */
async function orcamentosDaReserva(
  ctx: Ctx,
  numeros: string[] | undefined,
): Promise<OrcamentoReserva[] | string> {
  if (!ctx.leadId) return "Não há lead nesta conversa para achar o orçamento.";
  const { data: quotes } = await ctx.admin
    .from("quotes")
    .select("id, total, valor_a_vista, desconto, parcelas, status, created_at")
    .eq("empresa_id", ctx.empresaId)
    .eq("crm_lead_id", ctx.leadId)
    .neq("status", "convertido")
    .order("created_at", { ascending: false })
    .limit(20);
  const lista = (quotes ?? []) as Array<{
    id: string;
    total: number;
    valor_a_vista: number | null;
    desconto: number | null;
    parcelas: number | null;
  }>;
  if (!lista.length)
    return "Não achei orçamento aberto deste cliente. Crie o orçamento (criar_orcamento) antes de reservar.";
  let escolhidos = lista.slice(0, 1);
  if (numeros?.length) {
    escolhidos = [];
    for (const n of numeros) {
      const limpo = n.replace(/[^0-9a-f-]/gi, "").toLowerCase();
      const q = lista.find((x) => x.id.toLowerCase().startsWith(limpo));
      if (!q) return `Orçamento nº ${n} não encontrado entre os orçamentos abertos deste cliente.`;
      if (!escolhidos.includes(q)) escolhidos.push(q);
    }
  }
  const { data: itens } = await ctx.admin
    .from("quote_items")
    .select(
      "quote_id, tabela_preco_item_id, nome_snapshot, tipo_servico, preco_aplicado, quantidade, display_order",
    )
    .eq("empresa_id", ctx.empresaId)
    .in(
      "quote_id",
      escolhidos.map((q) => q.id),
    )
    .order("display_order");
  return escolhidos.map((q) => ({
    id: q.id,
    total: Number(q.total),
    pix: q.valor_a_vista === null ? null : Number(q.valor_a_vista),
    desconto: Number(q.desconto ?? 0),
    parcelas: Number(q.parcelas ?? 1),
    itens: ((itens ?? []) as Array<Record<string, unknown>>)
      .filter((i) => i["quote_id"] === q.id)
      .map((i) => ({
        tabelaItemId: (i["tabela_preco_item_id"] as string | null) ?? null,
        nome: String(i["nome_snapshot"] ?? "Item"),
        servico: (i["tipo_servico"] === "impermeabilizacao"
          ? "impermeabilizacao"
          : "higienizacao") as ServicoOrcamento,
        preco: Number(i["preco_aplicado"] ?? 0),
        quantidade: Number(i["quantidade"] ?? 1),
      })),
  }));
}

/** Atendentes que participaram da conversa (mensagens que não são da Alice nem automáticas). */
async function participacoes(ctx: Ctx, conversas: string[]) {
  const { data: msgs } = await ctx.admin
    .from("whatsapp_messages")
    .select(
      "id, conversa_id, direction, remetente_tipo, privada, text_content, message_timestamp, raw_event_reference, chatwoot_message_id",
    )
    .eq("empresa_id", ctx.empresaId)
    .in("conversa_id", conversas)
    .order("message_timestamp")
    .limit(1000);
  const todas = (msgs ?? []) as Array<{
    id: string;
    conversa_id: string;
    direction: string;
    remetente_tipo: string | null;
    privada: boolean;
    text_content: string | null;
    message_timestamp: string;
    raw_event_reference: string | null;
    chatwoot_message_id: number | null;
  }>;
  const daEquipe = todas.filter(
    (m) =>
      m.direction === "Enviada" &&
      m.remetente_tipo === "user" &&
      !m.privada &&
      !/^[#/]\S+/.test((m.text_content ?? "").trim()),
  );
  if (!daEquipe.length) return [];

  // Campanhas e lembretes (mkt_envios) saem pelo Chatwoot, mas não são atendente.
  const ids = daEquipe.map((m) => m.chatwoot_message_id).filter((x): x is number => x !== null);
  const { data: envios } = ids.length
    ? await ctx.admin
        .from("mkt_envios")
        .select("chatwoot_message_id")
        .eq("empresa_id", ctx.empresaId)
        .in("chatwoot_message_id", ids)
    : { data: [] };
  const deCampanha = new Set((envios ?? []).map((e) => e.chatwoot_message_id));

  const refs = daEquipe
    .map((m) => m.raw_event_reference)
    .filter((r): r is string => Boolean(r && /^[0-9a-f-]{36}$/i.test(r)));
  const { data: eventos } = refs.length
    ? await ctx.admin.from("integracao_eventos").select("id, payload").in("id", refs)
    : { data: [] };
  const payloads = new Map(
    ((eventos ?? []) as Array<{ id: string; payload: Record<string, unknown> | null }>).map((e) => [
      e.id,
      e.payload ?? {},
    ]),
  );

  // Saudações já vistas: textos de eco que saíram até 10 s da 1ª mensagem do cliente.
  // Saudação/ausência é texto curto: os longos não entram na busca (consulta enxuta).
  const textosEco = [
    ...new Set(
      daEquipe.map((m) => (m.text_content ?? "").trim()).filter((t) => t && t.length <= 300),
    ),
  ];
  const vistas = new Set<string>();
  if (textosEco.length) {
    const { data: iguais } = await ctx.admin
      .from("whatsapp_messages")
      .select("conversa_id, text_content, message_timestamp")
      .eq("empresa_id", ctx.empresaId)
      .eq("direction", "Enviada")
      .in("text_content", textosEco.slice(0, 20))
      .not("conversa_id", "in", `(${conversas.join(",")})`)
      .limit(200);
    const outras = [...new Set((iguais ?? []).map((m) => m.conversa_id as string))];
    if (outras.length) {
      const { data: primeiras } = await ctx.admin
        .from("whatsapp_messages")
        .select("conversa_id, message_timestamp")
        .eq("empresa_id", ctx.empresaId)
        .eq("direction", "Recebida")
        .in("conversa_id", outras.slice(0, 100))
        .order("message_timestamp")
        .limit(2000);
      const primeira = new Map<string, string>();
      for (const p of primeiras ?? [])
        if (!primeira.has(p.conversa_id as string))
          primeira.set(p.conversa_id as string, p.message_timestamp as string);
      for (const m of iguais ?? []) {
        const p = primeira.get(m.conversa_id as string);
        if (p && Math.abs(Date.parse(m.message_timestamp as string) - Date.parse(p)) <= 10_000)
          vistas.add(String(m.text_content).trim());
      }
    }
  }

  const resultado: Participacao[] = [];
  for (const m of daEquipe) {
    if (m.chatwoot_message_id !== null && deCampanha.has(m.chatwoot_message_id)) continue;
    const p = m.raw_event_reference ? payloads.get(m.raw_event_reference) : undefined;
    const sender = (p?.["sender"] ?? null) as {
      type?: string;
      name?: string;
      email?: string;
    } | null;
    if (sender && sender.type && sender.type !== "user") continue; // robô
    if (sender && sender.type === "user") {
      resultado.push({
        nome: sender.name ?? null,
        email: sender.email ?? null,
        quando: m.message_timestamp,
      });
      continue;
    }
    // Eco do celular (sem remetente): não conta a saudação/ausência automática.
    const daConversa = todas.filter((x) => x.conversa_id === m.conversa_id);
    const primeira = daConversa.find((x) => x.direction === "Recebida")?.message_timestamp ?? null;
    const enviadaAntes = primeira
      ? daConversa.some(
          (x) =>
            x.direction === "Enviada" &&
            x.id !== m.id &&
            Date.parse(x.message_timestamp) < Date.parse(primeira) - 10_000,
        )
      : true;
    if (
      ecoAutomatico({
        quando: m.message_timestamp,
        texto: m.text_content ?? "",
        primeiraDoCliente: primeira,
        enviadaAntes,
        saudacoesVistas: vistas,
      })
    )
      continue;
    resultado.push({ nome: null, email: null, quando: m.message_timestamp });
  }
  return resultado;
}

async function vendedoraDaReserva(ctx: Ctx, lead: { salesperson_id: string | null } | null) {
  const [{ data: vend }, { data: conversa }, { data: tarefas }] = await Promise.all([
    ctx.admin
      .from("salespeople")
      .select("id, name, email, eh_ia, commission_percentage, user_id")
      .eq("empresa_id", ctx.empresaId)
      .eq("active", true),
    ctx.admin
      .from("conversas")
      .select("id, responsavel_nome")
      .eq("id", ctx.conversaId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle(),
    ctx.admin
      .from("ia_tarefas")
      .select("id")
      .eq("empresa_id", ctx.empresaId)
      .eq("conversa_id", ctx.conversaId)
      .eq("tipo", "passar_para_humano")
      .in("situacao", ["pendente", "processando", "concluida"])
      .limit(1),
  ]);
  const lista = (vend ?? []) as Array<{
    id: string;
    name: string;
    email: string | null;
    eh_ia: boolean;
    commission_percentage: number;
    user_id: string | null;
  }>;
  const emails = new Map<string, string>();
  for (const v of lista.filter((x) => x.user_id)) {
    const { data } = await ctx.admin.auth.admin.getUserById(v.user_id!);
    if (data?.user?.email) emails.set(v.id, data.user.email);
  }
  const vendedoras: Vendedora[] = lista.map((v) => ({
    id: v.id,
    nome: v.name,
    email: v.email,
    emailLogin: emails.get(v.id) ?? null,
    ehIa: v.eh_ia,
    comissao: Number(v.commission_percentage ?? 0),
  }));

  const conversas = [ctx.conversaId];
  if (ctx.leadId) {
    const { data: outras } = await ctx.admin
      .from("conversas")
      .select("id")
      .eq("empresa_id", ctx.empresaId)
      .eq("crm_lead_id", ctx.leadId)
      .limit(10);
    for (const c of outras ?? []) if (!conversas.includes(c.id)) conversas.push(c.id);
  }
  const responsavel = (conversa as { responsavel_nome?: string | null } | null)?.responsavel_nome;
  return escolherVendedora({
    participacoes: await participacoes(ctx, conversas),
    // A transferência que a Alice pede (motivo "upsell" depois do agendamento) não conta aqui:
    // antes de agendar, uma passagem para a equipe significa que alguém assumiu.
    assumiu: Boolean(tarefas?.length),
    responsavel: responsavel ? { nome: responsavel } : null,
    vendedoraDoLead: lead?.salesperson_id ?? null,
    vendedoras,
  });
}

async function origemDaReserva(
  ctx: Ctx,
  lead: { id: string; sales_origin_id: string | null } | null,
  telefone: string | null,
) {
  const [{ data: opcoes }, { data: cliques }, { data: indicacoes }] = await Promise.all([
    ctx.admin
      .from("config_options")
      .select("id, name, metadata")
      .eq("empresa_id", ctx.empresaId)
      .eq("kind", "sales_origin")
      .eq("active", true),
    lead
      ? ctx.admin
          .from("ads_clicks")
          .select("gclid, gbraid, fbclid, utm_source")
          .eq("empresa_id", ctx.empresaId)
          .eq("crm_lead_id", lead.id)
          .limit(20)
      : Promise.resolve({ data: [] }),
    telefone
      ? ctx.admin
          .from("indicacoes")
          .select("id, indicado_phone")
          .eq("empresa_id", ctx.empresaId)
          .ilike("indicado_phone", `%${telefone.replace(/\D/g, "").slice(-8)}%`)
          .limit(1)
      : Promise.resolve({ data: [] }),
  ]);
  const escolha = escolherOrigem({
    origemDoLead: lead?.sales_origin_id ?? null,
    cliques: (cliques ?? []) as never,
    indicado: Boolean(indicacoes?.length),
    opcoes: ((opcoes ?? []) as Array<{ id: string; name: string; metadata: unknown }>).map((o) => ({
      id: o.id,
      nome: o.name,
      codigo: ((o.metadata ?? {}) as { codigo?: string }).codigo ?? null,
    })),
  });
  if (escolha.id) return escolha;
  // "WhatsApp" (ou a origem do anúncio) ainda não existe na empresa: cria.
  const { data: criada } = await ctx.admin
    .from("config_options")
    .insert({
      empresa_id: ctx.empresaId,
      kind: "sales_origin",
      name: escolha.nome,
      display_order: escolha.codigo === ORIGEM_WHATSAPP.codigo ? 95 : 50,
      metadata: { codigo: escolha.codigo, palavras: [] } as never,
    })
    .select("id")
    .single();
  return { ...escolha, id: criada?.id ?? null };
}

// ---------------------------------------------------------------- reservar
/** OS que a Alice reservou nesta conversa (para gerar o documento ou não duplicar). */
async function osDaConversa(ctx: Ctx): Promise<{ id: string; os_number: string } | null> {
  if (ctx.osReservada) return ctx.osReservada;
  const { data } = await ctx.admin
    .from("work_order_history")
    .select("work_order_id, work_orders!inner(id, os_number, status, deleted_at)")
    .eq("empresa_id", ctx.empresaId)
    .eq("event_type", "Criação")
    .eq("details->>conversa_id", ctx.conversaId)
    .order("created_at", { ascending: false })
    .limit(1);
  const wo = (
    data?.[0] as unknown as
      | {
          work_orders: { id: string; os_number: string; status: string; deleted_at: string | null };
        }
      | undefined
  )?.work_orders;
  if (!wo || wo.deleted_at || /cancel/i.test(wo.status)) return null;
  return { id: wo.id, os_number: wo.os_number };
}

export async function reservarHorario(ctx: Ctx, input: ReservarHorarioInput): Promise<Resultado> {
  const ja = await osDaConversa(ctx);
  if (ja)
    return {
      erro: true,
      texto: `Este cliente já tem a OS ${ja.os_number} reservada nesta conversa. Para mudar data, horário ou itens, transfira para a equipe (motivo "reagendar").`,
    };

  // 1. Horário ainda livre (mesma regra de consultar_agenda).
  const agenda = await carregarAgenda(ctx, input.data, input.data);
  if ("erro" in agenda)
    return { erro: true, texto: `Não foi possível conferir a agenda: ${agenda.erro}` };
  const { agendaLivre } = await import("./agenda");
  const [dia] = agendaLivre({
    inicio: input.data,
    dias: 1,
    base: agenda.horarios,
    ocupacoes: agenda.ocupacoes,
    periodo: "qualquer",
    agora: agoraSP(),
    cliente: null,
  });
  const livres = (dia?.livres ?? []).filter((h) => h.hora === input.hora);
  const pedido = input.tecnico ? norm(input.tecnico) : "";
  const slot = pedido
    ? (livres.find((h) => norm(h.tecnico) === pedido) ??
      livres.find((h) => norm(h.tecnico).includes(pedido) || pedido.includes(norm(h.tecnico))))
    : livres[0];
  if (!slot) {
    return {
      erro: true,
      texto: `O horário ${diaCurto(input.data)} às ${input.hora} não está mais livre${input.tecnico ? ` para ${input.tecnico}` : ""}. Consulte a agenda de novo (consultar_agenda) e ofereça outro horário ao cliente.`,
    };
  }

  // 2. Orçamento(s) aceito(s) → atendimentos e valores.
  const orcamentos = await orcamentosDaReserva(ctx, input.orcamentos);
  if (typeof orcamentos === "string") return { erro: true, texto: orcamentos };
  const visitas = visitasDosOrcamentos(orcamentos);
  if (!visitas.length)
    return { erro: true, texto: "O orçamento não tem itens. Refaça o orçamento." };
  const valores = valoresDaReserva(
    orcamentos,
    input.pagamento,
    input.parcelas ?? null,
    Number(ctx.cfg.desconto_pix_percentual),
  );

  const { data: servicos } = await ctx.admin
    .from("config_options")
    .select("id, name")
    .eq("empresa_id", ctx.empresaId)
    .eq("kind", "service_type")
    .eq("active", true);
  const servicoId = (s: ServicoOrcamento) =>
    (servicos ?? []).find((x) =>
      norm(x.name).includes(s === "higienizacao" ? "higien" : "impermeab"),
    )?.id ?? null;
  for (const v of visitas)
    if (!servicoId(v.servico))
      return {
        erro: true,
        texto: `O serviço de ${v.servico === "higienizacao" ? "higienização" : "impermeabilização"} não está cadastrado na empresa. Transfira para a equipe (motivo "reservar horário").`,
      };

  // 3. Endereço (CEP completa rua, bairro, cidade e UF).
  const cep = input.cep.replace(/\D/g, "");
  if (cep.length !== 8) return { erro: true, texto: "CEP inválido. Peça o CEP com 8 números." };
  const { enderecoDoCep } = await import("@/lib/quotes.server");
  const { parts } = await enderecoDoCep(cep);
  const endereco = {
    street: input.rua || parts.street || null,
    street_number: input.numero,
    complement: input.complemento || null,
    neighborhood: input.bairro || parts.neighborhood || null,
    city: input.cidade || parts.city || null,
    state: (input.uf || parts.state || "").toUpperCase() || null,
    postal_code: `${cep.slice(0, 5)}-${cep.slice(5)}`,
  };
  if (!endereco.street || !endereco.neighborhood || !endereco.city || !endereco.state)
    return {
      erro: true,
      texto:
        "Não achei a rua/bairro/cidade por esse CEP. Peça o endereço completo (rua, número, bairro e cidade) e informe nos campos.",
    };

  // 4. Cliente, vendedora e origem.
  const lead = await lerLeadCompleto(ctx);
  const telefone = ((await telefoneDaConversa(ctx)) ?? lead?.phone ?? "").replace(/\D/g, "");
  if (telefone.length < 10)
    return { erro: true, texto: "Não achei o telefone do cliente. Transfira para a equipe." };
  const [vendedora, origem] = await Promise.all([
    vendedoraDaReserva(ctx, lead),
    origemDaReserva(ctx, lead, telefone),
  ]);
  if (!vendedora.vendedora)
    return {
      erro: true,
      texto: "Não há vendedora cadastrada na empresa. Transfira para a equipe.",
    };

  let clienteId = lead?.customer_id ?? null;
  if (!clienteId) {
    const { data: achado } = await ctx.admin
      .from("customers")
      .select("id")
      .eq("empresa_id", ctx.empresaId)
      .ilike("phone", `%${telefone.slice(-8)}%`)
      .limit(1);
    clienteId = achado?.[0]?.id ?? null;
  }
  const { geocodeParts } = await import("@/lib/geo.server");
  const coords = await geocodeParts(endereco).catch(() => null);
  const cliente = {
    full_name: input.nome_completo,
    phone: telefone,
    ...(input.email ? { email: input.email.toLowerCase() } : {}),
    ...(input.cpf_cnpj ? { document_number: input.cpf_cnpj } : {}),
    ...endereco,
    ...(input.ponto_referencia ? { reference_point: input.ponto_referencia } : {}),
    full_address: buildFullAddress(endereco),
    ...(coords ? { latitude: coords.lat, longitude: coords.lon } : {}),
  };
  if (clienteId) {
    const { error } = await ctx.admin
      .from("customers")
      .update(cliente)
      .eq("id", clienteId)
      .eq("empresa_id", ctx.empresaId);
    if (error) throw error;
  } else {
    const { data, error } = await ctx.admin
      .from("customers")
      .insert({ ...cliente, empresa_id: ctx.empresaId })
      .select("id")
      .single();
    if (error) throw error;
    clienteId = data.id;
  }

  // 5. OS com o próximo número (tenta de novo se outra pessoa usou o mesmo número agora).
  const comissao = vendedora.vendedora.comissao;
  const hoje = agoraSP().data;
  const notas = [
    `Agendado pela ${ctx.cfg.nome} (IA) pelo WhatsApp.`,
    input.observacoes ? `Observações do cliente: ${input.observacoes}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  let wo: { id: string; os_number: string } | null = null;
  for (let tentativa = 0; tentativa < 4 && !wo; tentativa++) {
    const { data: ultimas } = await ctx.admin
      .from("work_orders")
      .select("os_number")
      .eq("empresa_id", ctx.empresaId)
      .order("created_at", { ascending: false })
      .limit(50);
    const numero = proximoNumeroOS((ultimas ?? []).map((r) => r.os_number));
    const { data, error } = await ctx.admin
      .from("work_orders")
      .insert({
        empresa_id: ctx.empresaId,
        os_number: numero,
        customer_id: clienteId,
        status: "Agendada",
        sale_date: hoje,
        sales_origin_id: origem.id,
        salesperson_id: vendedora.vendedora.id,
        total_gross_value: valores.total,
        items_sum: valores.somaItens,
        adjustment_reason: valores.motivoAjuste,
        manual_total_reason: valores.motivoAjuste,
        negotiated_payment_method: valores.forma,
        negotiated_installments: valores.parcelas,
        general_notes: notas,
        collection_rule: defaultCollectionRule(
          visitas.map((v, i) => ({
            id: String(i),
            scheduled_date: input.data,
            scheduled_time: input.hora,
            status: "Agendado",
            service_name: v.servico === "higienizacao" ? "Higienização" : "Impermeabilização",
            amount: 0,
          })),
        ),
        collection_configuration_updated_at: new Date().toISOString(),
        commission_percentage_snapshot: comissao,
        commission_expected: Math.round(((valores.total * comissao) / 100) * 100) / 100,
      })
      .select("id, os_number")
      .single();
    if (!error) wo = data;
    else if (error.code !== "23505") throw error;
  }
  if (!wo)
    return { erro: true, texto: "Não consegui gerar o número da OS. Transfira para a equipe." };

  const visitIds: string[] = [];
  // O mesmo item nos dois serviços fica no mesmo grupo (o documento combinado junta numa linha).
  const grupoIds = new Map<string, string>();
  for (const v of visitas) {
    const soma = Math.round(v.itens.reduce((s, i) => s + i.quantity * i.unit_price, 0) * 100) / 100;
    const { data: visita, error } = await ctx.admin
      .from("visits")
      .insert({
        empresa_id: ctx.empresaId,
        work_order_id: wo.id,
        service_type_id: servicoId(v.servico),
        scheduled_date: input.data,
        scheduled_time: input.hora,
        technician_id: slot.tecnicoId,
        status: "Agendado",
        visit_value: soma,
        item_quantity: v.itens.reduce((s, i) => s + i.quantity, 0) || 1,
        upholstery_description:
          v.itens.map((i) => `${i.quantity}x ${i.description}`).join(", ") || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    visitIds.push(visita.id);
    const { error: e2 } = await ctx.admin.from("service_items").insert(
      v.itens.map((i) => {
        if (!grupoIds.has(i.grupo)) grupoIds.set(i.grupo, crypto.randomUUID());
        return {
          empresa_id: ctx.empresaId,
          visit_id: visita.id,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
          subtotal: Math.round(i.quantity * i.unit_price * 100) / 100,
          item_group_id: grupoIds.get(i.grupo)!,
          display_order: i.display_order,
          active: true,
        };
      }),
    );
    if (e2) throw e2;
  }
  ctx.osReservada = { id: wo.id, os_number: wo.os_number };
  await ctx.admin.from("work_order_history").insert({
    empresa_id: ctx.empresaId,
    work_order_id: wo.id,
    event_type: "Criação",
    description: `OS ${wo.os_number} criada pela ${ctx.cfg.nome} (IA) com ${visitas.length} serviço(s), agendada para ${diaCurto(input.data)} às ${input.hora}.`,
    details: {
      conversa_id: ctx.conversaId,
      orcamentos: orcamentos.map((o) => o.id),
      vendedora: vendedora.vendedora.nome,
      origem: origem.nome,
    } as never,
  });

  // 6. Lead convertido, orçamentos convertidos.
  await converterLead(ctx, lead, wo.id, origem.id);
  await ctx.admin
    .from("quotes")
    .update({ status: "convertido", generated_work_order_id: wo.id } as never)
    .eq("empresa_id", ctx.empresaId)
    .in(
      "id",
      orcamentos.map((o) => o.id),
    );

  // 7. Google Agenda (se a empresa usa).
  await executarNaEmpresa({ db: ctx.admin, empresaId: ctx.empresaId, userId: "" }, async () => {
    const { syncEvent } = await import("@/lib/calendar.server");
    for (const id of visitIds) await syncEvent("visit", id);
  }).catch((e) => console.error("Alice: agenda Google não sincronizada", e));

  // 8. Aviso à equipe (Avisos no app e notificação no celular).
  const aviso = avisoAgendamento({
    cliente: input.nome_completo,
    data: input.data,
    hora: input.hora,
    valores,
    os: wo.os_number,
    tecnico: slot.tecnico,
    vendedora: vendedora.vendedora.nome,
    conferir: vendedora.conferir,
  });
  await ctx.admin.from("mkt_avisos").insert({
    empresa_id: ctx.empresaId,
    tipo: "agendamento_alice",
    titulo: aviso.titulo,
    mensagem: aviso.mensagem,
  });

  return {
    erro: false,
    texto: [
      `Horário reservado. OS ${wo.os_number} criada no sistema.`,
      `Dia: ${diaCurto(input.data)} · chegada a partir de ${input.hora}`,
      `Técnico: ${slot.tecnico}`,
      `Endereço: ${buildFullAddress(endereco)}`,
      `Valor: ${textoPagamento(valores)}, pago após o serviço`,
      "Agora use gerar_ordem_servico (manda a OS em PDF) e enviar_dados_tecnico, e faça a confirmação final com estes dados.",
    ].join("\n"),
  };
}

async function converterLead(
  ctx: Ctx,
  lead: { id: string; status_id: string | null; sales_origin_id: string | null } | null,
  workOrderId: string,
  origemId: string | null,
) {
  if (!lead) return;
  const { data: status } = await ctx.admin
    .from("config_options")
    .select("id, name, metadata")
    .eq("empresa_id", ctx.empresaId)
    .eq("kind", "crm_status")
    .eq("active", true)
    .order("display_order");
  const convertido = (status ?? []).find((s) => {
    const m = (s.metadata ?? {}) as { closed?: boolean; lost?: boolean };
    return m.closed === true && m.lost !== true;
  });
  const agora = new Date().toISOString();
  await ctx.admin
    .from("crm_leads")
    .update({
      linked_work_order_id: workOrderId,
      is_open: false,
      closed_at: agora,
      last_interaction_at: agora,
      next_follow_up_at: null,
      ...(lead.sales_origin_id ? {} : { sales_origin_id: origemId }),
      ...(convertido ? { status_id: convertido.id } : {}),
    } as never)
    .eq("id", lead.id)
    .eq("empresa_id", ctx.empresaId);
  if (convertido && lead.status_id !== convertido.id) {
    const anterior = (status ?? []).find((s) => s.id === lead.status_id);
    await ctx.admin.from("crm_status_history").insert({
      empresa_id: ctx.empresaId,
      crm_lead_id: lead.id,
      previous_status_id: lead.status_id,
      previous_status_name: anterior?.name ?? null,
      new_status_id: convertido.id,
      new_status_name: convertido.name,
      change_source: ctx.cfg.nome,
      notes: "Lead convertido em OS (agendado pela IA)",
    });
  }
}

// ---------------------------------------------------------------- documento
export async function gerarOrdemServico(ctx: Ctx): Promise<Resultado> {
  const os = await osDaConversa(ctx);
  if (!os)
    return {
      erro: true,
      texto: "Ainda não há OS reservada nesta conversa. Use reservar_horario antes.",
    };
  try {
    const r = await executarNaEmpresa(
      { db: ctx.admin, empresaId: ctx.empresaId, userId: "" },
      async () => {
        const { generateDocument, loadDocument, readSettings } =
          await import("@/lib/os-docs.server");
        const s = await readSettings();
        if (!s.enabled) throw new Error("documento da OS desligado nas Configurações");
        const atual = await loadDocument(os.id);
        if (atual?.status === "Gerado" && atual.url) return { url: atual.url };
        return generateDocument(os.id, atual ? "atualizar" : "novo", null);
      },
    );
    const { extractGoogleId } = await import("@/lib/google-docs.server");
    const docId = extractGoogleId(r.url ?? "");
    if (!docId) throw new Error("documento sem endereço do Google");
    ctx.saida.push({
      tipo: "anexo",
      caminho: docId,
      nome: `OS ${os.os_number}.pdf`,
      googleDoc: true,
      semEspera: true,
    });
    return {
      erro: false,
      texto: `A OS ${os.os_number} vai em PDF neste ponto da conversa. Não diga "segue abaixo"; siga com a confirmação.`,
    };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error("Alice: documento da OS não gerado", motivo);
    await ctx.admin.from("mkt_avisos").insert({
      empresa_id: ctx.empresaId,
      tipo: "agendamento_alice",
      titulo: "OS da Alice sem documento",
      mensagem: `A OS ${os.os_number} foi criada, mas o documento não foi gerado (${motivo.slice(0, 200)}). Gere e mande ao cliente pelo app.`,
    });
    return {
      erro: false,
      texto: `O agendamento está feito (OS ${os.os_number}), mas o documento da OS não saiu agora. Faça a confirmação normalmente e diga que a equipe manda a OS em seguida.`,
    };
  }
}
