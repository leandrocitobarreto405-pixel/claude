/**
 * Upsell depois do agendamento (antes: adicional pós-fechamento). A Alice oferece uma vez só, logo
 * depois que o cliente confirma; se ele aceitar, o item entra no mesmo orçamento (e na OS, se já
 * foi gerada), fora do desconto de campanha e de indicação. Preço: com o upsell ligado nas regras
 * de orçamento, a tabela − o desconto de item adicional (qualquer item, menos tapete e persiana);
 * desligado, o preço de adicional fixo da tabela, como antes. Com a OS gerada, só inclui se o
 * atendimento ainda couber antes do próximo serviço do mesmo técnico no dia.
 */
import { acharOrcamento } from "@/lib/numero-orcamento";
import { linhasPagamento } from "@/lib/texto-pagamento";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { condicoesPagamento, normalizarNome, reais } from "./regras";
import { cabeNoHorario, duracaoDoAtendimento, precoUpsell } from "./upsell";

type Admin = SupabaseClient<Database>;
type Ctx = {
  admin: Admin;
  empresaId: string;
  leadId: string | null;
  conversaId: string;
  cfg: { nome: string; parcelas_max: number; desconto_pix_percentual: number | string };
};

export type AcaoAdicional = "oferecer" | "aceitou" | "recusou";
type Resultado = { erro: boolean; texto: string };

type Orcamento = {
  id: string;
  numero: number | null;
  status: string;
  generated_work_order_id: string | null;
  adicional_oferecido_em: string | null;
  adicional_aceito: boolean | null;
};

async function orcamentoDoCliente(ctx: Ctx, numero?: string): Promise<Orcamento | string> {
  if (!ctx.leadId) return "Não há lead nesta conversa para achar o orçamento.";
  const { data } = await ctx.admin
    .from("quotes")
    .select("id, numero, status, generated_work_order_id, adicional_oferecido_em, adicional_aceito")
    .eq("empresa_id", ctx.empresaId)
    .eq("crm_lead_id", ctx.leadId)
    .neq("status", "recusado")
    .order("created_at", { ascending: false })
    .limit(20);
  const lista = (data ?? []) as Orcamento[];
  if (!lista.length) return "Não achei orçamento deste cliente.";
  if (numero) {
    // Número novo ("0153") e, de conversas antigas, o id curto.
    const q = acharOrcamento(lista, numero);
    if (!q) return `Orçamento Nº ${numero} não encontrado.`;
    return q;
  }
  // O fechado (convertido/aprovado) tem preferência sobre um mais novo ainda em aberto.
  return lista.find((q) => q.status === "convertido" || q.status === "aprovado") ?? lista[0]!;
}

type ItemAdicional = {
  id: string;
  nome: string;
  categoria: string | null;
  preco_higienizacao: number;
  preco_adicional: number;
};

async function itensAdicionais(ctx: Ctx, upsell: { ligado: boolean; pct: number }) {
  let q = ctx.admin
    .from("tabela_precos_itens")
    .select("id, nome, categoria, preco_higienizacao, preco_adicional")
    .eq("empresa_id", ctx.empresaId)
    .eq("ativo", true)
    .order("ordem");
  if (!upsell.ligado) q = q.not("preco_adicional", "is", null);
  const { data } = await q;
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter(
      (i) =>
        !upsell.ligado ||
        (Number(i["preco_higienizacao"]) > 0 &&
          !["tapete", "persiana"].includes(String(i["categoria"] ?? ""))),
    )
    .map((i): ItemAdicional => ({
      id: String(i["id"]),
      nome: String(i["nome"]),
      categoria: (i["categoria"] as string | null) ?? null,
      preco_higienizacao: Number(i["preco_higienizacao"]),
      preco_adicional: upsell.ligado
        ? precoUpsell(Number(i["preco_higienizacao"]), upsell.pct)
        : Number(i["preco_adicional"]),
    }));
}

/** OS já gerada: o atendimento com o item a mais ainda cabe antes do próximo serviço do técnico? */
async function conferirHorario(
  ctx: Ctx,
  workOrderId: string,
  item: ItemAdicional,
  quantidade: number,
): Promise<{ cabe: boolean; texto: string } | null> {
  const { data: visitas } = await ctx.admin
    .from("visits")
    .select(
      "id, scheduled_date, scheduled_time, technician_id, service_type:service_type_id ( name ), service_items ( description, quantity, active )",
    )
    .eq("work_order_id", workOrderId)
    .neq("status", "Cancelado")
    .order("scheduled_date");
  type V = {
    id: string;
    scheduled_date: string;
    scheduled_time: string | null;
    technician_id: string | null;
    service_type: { name: string } | null;
    service_items: Array<{ description: string | null; quantity: number; active: boolean }>;
  };
  const lista = (visitas ?? []) as unknown as V[];
  const v =
    lista.find((x) => (x.service_type?.name ?? "").toLowerCase().includes("higien")) ?? lista[0];
  if (!v?.scheduled_time || !v.technician_id) return null;
  const { data: proximas } = await ctx.admin
    .from("visits")
    .select("scheduled_time")
    .eq("empresa_id", ctx.empresaId)
    .eq("technician_id", v.technician_id)
    .eq("scheduled_date", v.scheduled_date)
    .gt("scheduled_time", v.scheduled_time)
    .neq("status", "Cancelado")
    .neq("id", v.id)
    .order("scheduled_time")
    .limit(1);
  const itens = [
    ...v.service_items
      .filter((i) => i.active)
      .map((i) => ({ descricao: i.description ?? "", quantidade: Number(i.quantity) })),
    { descricao: item.nome, quantidade },
  ];
  const r = cabeNoHorario(
    v.scheduled_time.slice(0, 5),
    duracaoDoAtendimento(itens),
    (proximas ?? [])[0]?.scheduled_time?.slice(0, 5) ?? null,
  );
  return { cabe: r.cabe, texto: r.texto };
}

export async function adicionalPosFechamento(
  ctx: Ctx,
  input: {
    acao: AcaoAdicional;
    item?: string | undefined;
    quantidade?: number | undefined;
    orcamento?: string | undefined;
  },
): Promise<Resultado> {
  const q = await orcamentoDoCliente(ctx, input.orcamento);
  if (typeof q === "string") return { erro: true, texto: q };

  const { data: itensQ } = await ctx.admin
    .from("quote_items")
    .select("*")
    .eq("quote_id", q.id)
    .order("display_order");
  const itens = (itensQ ?? []) as unknown as Array<Record<string, unknown>>;
  if (itens.some((i) => i["tipo_servico"] !== "higienizacao"))
    return {
      erro: true,
      texto: "Este pedido tem impermeabilização: não ofereça o adicional.",
    };
  const { regrasOrcamento } = await import("@/lib/quotes.server");
  const upsell = (await regrasOrcamento(ctx.admin, ctx.empresaId)).upsell;
  const tabela = await itensAdicionais(ctx, upsell);
  if (!tabela.length)
    return { erro: true, texto: "A empresa não tem itens com preço de adicional. Não ofereça." };

  if (input.acao === "oferecer") {
    if (q.adicional_oferecido_em)
      return {
        erro: true,
        texto: "O adicional já foi oferecido neste pedido. Não ofereça de novo.",
      };
    const jaTem = new Set(itens.map((i) => i["tabela_preco_item_id"]));
    const opcoes = tabela.filter((t) => !jaTem.has(t.id));
    if (!opcoes.length)
      return { erro: true, texto: "O pedido já tem esses itens. Não ofereça o adicional." };
    await ctx.admin
      .from("quotes")
      .update({
        adicional_oferecido_em: new Date().toISOString(),
        // Oferta só depois da confirmação: o orçamento fica aprovado (se ainda não virou OS).
        ...(q.status === "rascunho" || q.status === "enviado" ? { status: "aprovado" } : {}),
      } as never)
      .eq("id", q.id);
    return {
      erro: false,
      texto: [
        upsell.ligado
          ? `Oferta registrada (uma vez só). Preços com o desconto de item adicional (${upsell.pct}% sobre a tabela; normal entre parênteses). Ofereça só o que o cliente ainda não incluiu:`
          : "Oferta registrada (uma vez só). Preços do adicional (normal entre parênteses):",
        ...opcoes.map(
          (o) => `- ${o.nome}: ${reais(o.preco_adicional)} (normal ${reais(o.preco_higienizacao)})`,
        ),
        'Se aceitar, use acao "aceitou" com o item; se recusar, acao "recusou".',
      ].join("\n"),
    };
  }

  if (!q.adicional_oferecido_em)
    return { erro: true, texto: 'Ofereça primeiro (acao "oferecer").' };
  if (q.adicional_aceito !== null)
    return {
      erro: true,
      texto: `A resposta do cliente já foi registrada (${q.adicional_aceito ? "aceitou" : "recusou"}).`,
    };

  if (input.acao === "recusou") {
    await ctx.admin
      .from("quotes")
      .update({ adicional_aceito: false } as never)
      .eq("id", q.id);
    return { erro: false, texto: "Recusa registrada. Siga o atendimento sem oferecer de novo." };
  }

  // aceitou
  const escolhido = tabela.find((t) => normalizarNome(t.nome) === normalizarNome(input.item ?? ""));
  if (!escolhido)
    return {
      erro: true,
      texto: `Item "${input.item ?? ""}" não tem preço de adicional. Itens válidos: ${tabela.map((t) => t.nome).join("; ")}.`,
    };
  const quantidade = Math.max(1, Math.min(10, Math.round(input.quantidade ?? 1)));

  // OS já gerada: só inclui se o atendimento ainda couber antes do próximo serviço do técnico.
  const horario = q.generated_work_order_id
    ? await conferirHorario(ctx, q.generated_work_order_id, escolhido, quantidade)
    : null;
  if (horario && !horario.cabe)
    return {
      erro: true,
      texto: `NÃO incluído: com ${quantidade > 1 ? `${quantidade}x ` : ""}${escolhido.nome}, o atendimento ${horario.texto}. Avise o cliente com cuidado e ofereça ajustar o horário (consultar_agenda e remarcar_horario); depois chame "aceitou" de novo. Se ele não quiser trocar, transfira com o motivo "upsell não cabe no horário".`,
    };

  // 1. Orçamento: o item entra pelo preço de adicional e o total é refeito pelas regras.
  const { data: qRow } = await ctx.admin.from("quotes").select("*").eq("id", q.id).single();
  const { quoteInputDoBanco, saveQuote } = await import("@/lib/quotes.server");
  const entrada = quoteInputDoBanco(qRow as unknown as Record<string, unknown>, itens);
  entrada.items.push({
    tabela_preco_item_id: escolhido.id,
    nome_snapshot: escolhido.nome,
    tipo_servico: "higienizacao",
    preco_tabela: escolhido.preco_higienizacao,
    preco_sugerido: escolhido.preco_adicional,
    preco_aplicado: escolhido.preco_adicional,
    motivo_desconto: null,
    quantidade,
    categoria: (escolhido.categoria as "sofa" | "colchao" | "cadeira" | "outro" | null) ?? null,
    adicional_pos_fechamento: true,
  });
  const pixPct = Number(ctx.cfg.desconto_pix_percentual);
  const salvo = await saveQuote(
    ctx.admin,
    { ...entrada, valor_a_vista: null },
    null,
    ctx.empresaId,
  );
  const cond = condicoesPagamento(salvo.total, ctx.cfg.parcelas_max, pixPct);
  await ctx.admin
    .from("quotes")
    .update({ adicional_aceito: true, valor_a_vista: cond.pix } as never)
    .eq("id", q.id);

  // 2. OS já gerada: o item entra no atendimento de higienização e os valores são atualizados.
  let os = "";
  if (q.generated_work_order_id) {
    os = await incluirNaOs(ctx, q.generated_work_order_id, escolhido, quantidade);
  }

  const subtotal = Math.round(escolhido.preco_adicional * quantidade * 100) / 100;
  return {
    erro: false,
    texto: [
      `Incluído no pedido: ${quantidade > 1 ? `${quantidade}x ` : ""}${escolhido.nome} (adicional) — ${reais(subtotal)}.${os}`,
      ...(horario ? [`Horário: cabe (o atendimento ${horario.texto}).`] : []),
      `Novo total: ${reais(cond.total)}`,
      "Pagamento para o cliente (copie exatamente assim, nestas linhas):",
      linhasPagamento({
        total: cond.total,
        parcelas: cond.parcelas,
        pix: cond.pix,
        pixPct: cond.descontoPixPercentual,
      }),
    ].join("\n"),
  };
}

async function incluirNaOs(
  ctx: Ctx,
  workOrderId: string,
  item: ItemAdicional,
  quantidade: number,
): Promise<string> {
  const { data: wo } = await ctx.admin
    .from("work_orders")
    .select("id, os_number, total_gross_value, items_sum, commission_percentage_snapshot")
    .eq("id", workOrderId)
    .eq("empresa_id", ctx.empresaId)
    .single();
  if (!wo) return " (OS não encontrada: avise a equipe.)";
  const { data: visitas } = await ctx.admin
    .from("visits")
    .select("id, status, visit_value, service_type:service_type_id ( name )")
    .eq("work_order_id", workOrderId)
    .neq("status", "Cancelado")
    .order("scheduled_date");
  const lista = (visitas ?? []) as unknown as Array<{
    id: string;
    visit_value: number;
    service_type: { name: string } | null;
  }>;
  const visita =
    lista.find((v) => (v.service_type?.name ?? "").toLowerCase().includes("higien")) ?? lista[0];
  if (!visita) return " (OS sem atendimento ativo: avise a equipe.)";

  const subtotal = Math.round(item.preco_adicional * quantidade * 100) / 100;
  const { data: ultimos } = await ctx.admin
    .from("service_items")
    .select("display_order")
    .eq("visit_id", visita.id)
    .order("display_order", { ascending: false })
    .limit(1);
  const ordem = Number((ultimos ?? [])[0]?.display_order ?? -1) + 1;
  await ctx.admin.from("service_items").insert({
    empresa_id: ctx.empresaId,
    visit_id: visita.id,
    description: `${item.nome} — Higienização (adicional)`,
    quantity: quantidade,
    unit_price: item.preco_adicional,
    subtotal,
    preco_tabela: item.preco_higienizacao,
    item_group_id: crypto.randomUUID(),
    display_order: ordem,
    active: true,
    adicional_pos_fechamento: true,
  } as never);
  const novoTotal = Math.round((Number(wo.total_gross_value) + subtotal) * 100) / 100;
  await ctx.admin
    .from("visits")
    .update({ visit_value: Math.round((Number(visita.visit_value) + subtotal) * 100) / 100 })
    .eq("id", visita.id);
  await ctx.admin
    .from("work_orders")
    .update({
      total_gross_value: novoTotal,
      items_sum: Math.round((Number(wo.items_sum ?? 0) + subtotal) * 100) / 100,
      commission_expected:
        Math.round(((novoTotal * Number(wo.commission_percentage_snapshot ?? 0)) / 100) * 100) /
        100,
    })
    .eq("id", workOrderId);
  await ctx.admin.from("work_order_history").insert({
    empresa_id: ctx.empresaId,
    work_order_id: workOrderId,
    event_type: "Edição",
    description: `${ctx.cfg.nome} (IA) incluiu ${quantidade > 1 ? `${quantidade}x ` : ""}${item.nome} como adicional pós-fechamento (${reais(subtotal)}).`,
    details: { conversa_id: ctx.conversaId, adicional_pos_fechamento: true } as never,
  });
  return ` Também incluído na OS ${wo.os_number}.`;
}
