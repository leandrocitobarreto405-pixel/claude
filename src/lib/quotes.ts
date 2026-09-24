import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type QuoteStatus = "rascunho" | "enviado" | "aprovado" | "recusado" | "convertido";
export type TipoServico = "higienizacao" | "impermeabilizacao";

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aprovado: "Aprovado",
  recusado: "Recusado",
  convertido: "Virou OS",
};

export const STATUS_CLASS: Record<QuoteStatus, string> = {
  rascunho: "bg-muted text-muted-foreground",
  enviado: "bg-primary/10 text-primary",
  aprovado: "bg-emerald-100 text-emerald-800",
  recusado: "bg-destructive/10 text-destructive",
  convertido: "bg-accent/15 text-accent-foreground",
};

export const TIPO_LABEL: Record<TipoServico, string> = {
  higienizacao: "Higienização",
  impermeabilizacao: "Impermeabilização",
};

export type QuoteItem = {
  id: string;
  tabela_preco_item_id: string | null;
  nome_snapshot: string;
  tipo_servico: TipoServico;
  preco_tabela: number;
  preco_aplicado: number;
  motivo_desconto: string | null;
  quantidade: number;
  subtotal: number;
  display_order: number;
};

export type Quote = {
  id: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  cliente_cep: string | null;
  cliente_endereco: string | null;
  customer_id: string | null;
  data_servico: string | null;
  observacoes: string | null;
  subtotal: number;
  desconto: number;
  total: number;
  valor_a_vista: number | null;
  km_ida_volta: number;
  custo_deslocamento: number;
  custo_produtos: number;
  custo_mao_obra: number;
  custo_total: number;
  margem_valor: number;
  margem_percentual: number;
  status: QuoteStatus;
  generated_work_order_id: string | null;
  created_at: string;
  forma_pagamento: string | null;
  parcelas: number;
  taxa_percentual: number;
  custo_taxa: number;
  custo_imposto: number;
  custo_fixo_alocado: number;
  lucro_valor: number | null;
  lucro_percentual: number | null;
  preencher_agenda: boolean;
  contribuicao_valor: number | null;
  contribuicao_percentual: number | null;
};

const QUOTE_SELECT =
  "id, cliente_nome, cliente_telefone, cliente_cep, cliente_endereco, customer_id, data_servico, observacoes, subtotal, desconto, total, valor_a_vista, km_ida_volta, custo_deslocamento, custo_produtos, custo_mao_obra, custo_total, margem_valor, margem_percentual, forma_pagamento, parcelas, taxa_percentual, custo_taxa, custo_imposto, custo_fixo_alocado, lucro_valor, lucro_percentual, preencher_agenda, contribuicao_valor, contribuicao_percentual, status, generated_work_order_id, created_at";

const round2 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

export type CustosOrcamento = {
  deslocamento: number;
  produtos: number;
  maoObra: number;
  taxa: number;
  imposto: number;
  fixo: number;
};

/** Espelho cliente do cálculo do servidor (computeQuote) para o semáforo em tempo real. */
export function lucroOrcamento(
  total: number,
  custos: CustosOrcamento,
): {
  custoTotal: number;
  lucro: number;
  lucroPct: number;
  contribuicao: number;
  contribuicaoPct: number;
} {
  const variaveis = round2(
    custos.deslocamento + custos.produtos + custos.maoObra + custos.taxa + custos.imposto,
  );
  const custoTotal = round2(variaveis + custos.fixo);
  const lucro = round2(total - custoTotal);
  const contribuicao = round2(total - variaveis);
  return {
    custoTotal,
    lucro,
    lucroPct: total > 0 ? round2((lucro / total) * 100) : 0,
    contribuicao,
    contribuicaoPct: total > 0 ? round2((contribuicao / total) * 100) : 0,
  };
}

export type ModoMargem = "normal" | "agenda";

export type AvaliacaoMargem = {
  status: "verde" | "amarelo" | "vermelho";
  rotulo: string;
  descontoAplicavel: number;
  pisoPreco: number | null;
};

/**
 * Semáforo de margem.
 * Modo normal: julga o lucro final (verde >= alvo, amarelo até o mínimo, vermelho abaixo).
 * Modo agenda: julga a margem de contribuição, ignorando o rateio de custos fixos.
 */
export function avaliarMargem(args: {
  total: number;
  lucroPct: number;
  contribuicaoPct: number;
  custosFixosNaoPercentuais: number;
  custosVariaveisDoServico: number;
  taxaPct: number;
  impostoPct: number;
  alvoPct: number;
  minPct: number;
  contribMinPct: number;
  contribWarnPct: number;
  modo: ModoMargem;
}): AvaliacaoMargem {
  const {
    total,
    lucroPct,
    contribuicaoPct,
    custosFixosNaoPercentuais,
    custosVariaveisDoServico,
    taxaPct,
    impostoPct,
    alvoPct,
    minPct,
    contribMinPct,
    contribWarnPct,
    modo,
  } = args;

  const agenda = modo === "agenda";
  const referencia = agenda ? contribuicaoPct : lucroPct;
  const verdeEm = agenda ? contribMinPct : alvoPct;
  const amareloEm = agenda ? contribWarnPct : minPct;
  const status = referencia >= verdeEm ? "verde" : referencia >= amareloEm ? "amarelo" : "vermelho";
  const rotulo = agenda
    ? status === "verde"
      ? "Pode fechar — boa contribuição para a agenda"
      : status === "amarelo"
        ? "Atenção — contribuição apertada"
        : "Não fechar nesse valor"
    : status === "verde"
      ? "Pode seguir — margem boa"
      : status === "amarelo"
        ? "Atenção — margem apertada"
        : "Não fechar nesse valor";

  // Preço mínimo P: P − custos − (taxa%+imposto%)·P = pisoPct·P
  const pisoPct = agenda ? contribMinPct : minPct;
  const custosDoPiso = agenda ? custosVariaveisDoServico : custosFixosNaoPercentuais;
  const denominador = 1 - (pisoPct + taxaPct + impostoPct) / 100;
  const pisoPreco = denominador > 0.01 ? Math.ceil((custosDoPiso / denominador) * 100) / 100 : null;
  const descontoAplicavel = pisoPreco === null ? 0 : Math.max(round2(total - pisoPreco), 0);

  return { status, rotulo, descontoAplicavel, pisoPreco };
}

const ITEM_SELECT =
  "id, tabela_preco_item_id, nome_snapshot, tipo_servico, preco_tabela, preco_aplicado, motivo_desconto, quantidade, subtotal, display_order";

/** Lista os orçamentos criados no mês informado ("2026-09"). */
export function useQuotes(month: string) {
  return useQuery({
    queryKey: ["quotes", month],
    queryFn: async () => {
      const inicio = `${month}-01T00:00:00`;
      const [y, m] = month.split("-").map(Number);
      const fim = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("quotes")
        .select(QUOTE_SELECT)
        .gte("created_at", inicio)
        .lt("created_at", `${fim}T00:00:00`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Quote[];
    },
  });
}

export function useQuote(id: string | null) {
  return useQuery({
    queryKey: ["quote", id],
    enabled: Boolean(id) && id !== "novo",
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select(QUOTE_SELECT).eq("id", id!).single();
      if (error) throw error;
      const { data: items, error: itemsErr } = await supabase
        .from("quote_items")
        .select(ITEM_SELECT)
        .eq("quote_id", id!)
        .order("display_order");
      if (itemsErr) throw itemsErr;
      return {
        quote: data as unknown as Quote,
        items: (items ?? []) as unknown as QuoteItem[],
      };
    },
  });
}

export async function setQuoteStatus(id: string, status: QuoteStatus) {
  const { error } = await supabase.from("quotes").update({ status } as never).eq("id", id);
  if (error) throw error;
}

export async function excluirOrcamento(id: string) {
  const { error } = await supabase.from("quotes").delete().eq("id", id);
  if (error) throw error;
}

/** Marca o orçamento como convertido e guarda a OS gerada. */
export async function linkQuoteToWorkOrder(id: string, workOrderId: string) {
  const { error } = await supabase
    .from("quotes")
    .update({ status: "convertido", generated_work_order_id: workOrderId } as never)
    .eq("id", id);
  if (error) throw error;
}

export function resumoDoMes(quotes: Quote[]) {
  const total = quotes.reduce((s, q) => s + Number(q.total ?? 0), 0);
  const convertidos = quotes.filter((q) => q.status === "convertido");
  const valorConvertido = convertidos.reduce((s, q) => s + Number(q.total ?? 0), 0);
  return {
    quantidade: quotes.length,
    total,
    convertidos: convertidos.length,
    valorConvertido,
    conversao: quotes.length ? (convertidos.length / quotes.length) * 100 : 0,
  };
}
