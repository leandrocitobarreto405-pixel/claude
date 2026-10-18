import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Categoria } from "@/lib/orcamento-regras";

export type ItemPreco = {
  id: string;
  nome: string;
  preco_higienizacao: number;
  preco_impermeabilizacao: number | null;
  ativo: boolean;
  ordem: number;
  categoria: Categoria;
  /** Preço como adicional pós-fechamento (higienização); vazio = não é oferecido. */
  preco_adicional: number | null;
  /** Serviço feito por parceiro: o cliente paga o preço cheio e a empresa repassa o custo. */
  terceirizado: boolean;
  /** Custo do parceiro por unidade do item (m² ou peça), na limpeza/higienização. */
  custo_parceiro: number | null;
  /** Custo do parceiro por unidade na impermeabilização. */
  custo_parceiro_impermeabilizacao: number | null;
  parceiro_id: string | null;
};

const SELECT =
  "id, nome, preco_higienizacao, preco_impermeabilizacao, ativo, ordem, categoria, preco_adicional, terceirizado, custo_parceiro, custo_parceiro_impermeabilizacao, parceiro_id";

export const CATEGORIA_LABEL: Record<Categoria, string> = {
  sofa: "Sofá",
  colchao: "Colchão",
  cadeira: "Cadeira",
  outro: "Outro",
  tapete: "Tapete (por m²)",
  persiana: "Persiana",
};

export function useTabelaPrecos(onlyActive = false) {
  return useQuery({
    queryKey: ["tabela-precos", onlyActive],
    queryFn: async () => {
      let q = supabase.from("tabela_precos_itens").select(SELECT).order("ordem").order("nome");
      if (onlyActive) q = q.eq("ativo", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ItemPreco[];
    },
  });
}

export type ItemPrecoInput = {
  nome: string;
  preco_higienizacao: number;
  preco_impermeabilizacao: number | null;
  ativo: boolean;
  categoria?: Categoria;
  preco_adicional?: number | null;
  terceirizado?: boolean;
  custo_parceiro?: number | null;
  custo_parceiro_impermeabilizacao?: number | null;
  parceiro_id?: string | null;
};

/** Técnicos parceiros (terceirizados) da empresa, para escolher no item da tabela. */
export function useParceiros() {
  return useQuery({
    queryKey: ["tecnicos-parceiros"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("technicians")
        .select("id, name")
        .eq("parceiro", true)
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export async function saveItemPreco(input: ItemPrecoInput, id?: string | null) {
  if (id) {
    const { error } = await supabase
      .from("tabela_precos_itens")
      .update(input as never)
      .eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data: last } = await supabase
    .from("tabela_precos_itens")
    .select("ordem")
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ordem = Number((last as { ordem?: number } | null)?.ordem ?? 0) + 1;
  const { data, error } = await supabase
    .from("tabela_precos_itens")
    .insert({ ...input, ordem } as never)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function setItemPrecoAtivo(id: string, ativo: boolean) {
  const { error } = await supabase
    .from("tabela_precos_itens")
    .update({ ativo } as never)
    .eq("id", id);
  if (error) throw error;
}

/** Salva a nova ordem depois do arrastar-e-soltar. */
export async function reordenarItensPreco(ids: string[]) {
  for (let i = 0; i < ids.length; i += 1) {
    const { error } = await supabase
      .from("tabela_precos_itens")
      .update({ ordem: i + 1 } as never)
      .eq("id", ids[i]!);
    if (error) throw error;
  }
}

/** Só permite excluir se o item nunca foi usado em um orçamento. */
/** Item usado em orçamento ou em OS: só pode ser desativado (o histórico aponta para ele). */
export async function itemPrecoEmUso(id: string) {
  const [orcamentos, os] = await Promise.all([
    supabase
      .from("quote_items")
      .select("id", { count: "exact", head: true })
      .eq("tabela_preco_item_id", id),
    supabase
      .from("service_items")
      .select("id", { count: "exact", head: true })
      .eq("tabela_preco_item_id", id),
  ]);
  if (orcamentos.error) throw orcamentos.error;
  if (os.error) throw os.error;
  return (orcamentos.count ?? 0) + (os.count ?? 0) > 0;
}

export async function excluirItemPreco(id: string) {
  const { error } = await supabase.from("tabela_precos_itens").delete().eq("id", id);
  if (error) throw error;
}
