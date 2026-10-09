/**
 * Adicional pós-fechamento (ex.: colchão num pedido só de higienização). A Alice oferece uma vez
 * só, depois que o cliente confirma; se ele aceitar, o item entra no mesmo orçamento (e na OS, se
 * já foi gerada) pelo preço de adicional da tabela, fora do desconto de campanha e de indicação.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { condicoesPagamento, normalizarNome, reais } from "./regras";

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
  status: string;
  generated_work_order_id: string | null;
  adicional_oferecido_em: string | null;
  adicional_aceito: boolean | null;
};

async function orcamentoDoCliente(ctx: Ctx, numero?: string): Promise<Orcamento | string> {
  if (!ctx.leadId) return "Não há lead nesta conversa para achar o orçamento.";
  const { data } = await ctx.admin
    .from("quotes")
    .select("id, status, generated_work_order_id, adicional_oferecido_em, adicional_aceito")
    .eq("empresa_id", ctx.empresaId)
    .eq("crm_lead_id", ctx.leadId)
    .neq("status", "recusado")
    .order("created_at", { ascending: false })
    .limit(20);
  const lista = (data ?? []) as Orcamento[];
  if (!lista.length) return "Não achei orçamento deste cliente.";
  if (numero) {
    const limpo = numero.replace(/[^0-9a-f-]/gi, "").toLowerCase();
    const q = lista.find((x) => x.id.toLowerCase().startsWith(limpo));
    if (!q) return `Orçamento nº ${numero} não encontrado.`;
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

async function itensAdicionais(ctx: Ctx): Promise<ItemAdicional[]> {
  const { data } = await ctx.admin
    .from("tabela_precos_itens")
    .select("id, nome, categoria, preco_higienizacao, preco_adicional")
    .eq("empresa_id", ctx.empresaId)
    .eq("ativo", true)
    .not("preco_adicional", "is", null)
    .order("ordem");
  return ((data ?? []) as Array<Record<string, unknown>>).map((i) => ({
    id: String(i["id"]),
    nome: String(i["nome"]),
    categoria: (i["categoria"] as string | null) ?? null,
    preco_higienizacao: Number(i["preco_higienizacao"]),
    preco_adicional: Number(i["preco_adicional"]),
  }));
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
  const tabela = await itensAdicionais(ctx);
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
        "Oferta registrada (uma vez só). Preços do adicional (normal entre parênteses):",
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
      `Novo total: ${reais(cond.total)}`,
      `Cartão: ${cond.parcelas}x de ${reais(cond.parcela)} sem juros`,
      `Pix (${cond.descontoPixPercentual}% off): ${reais(cond.pix)}`,
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
