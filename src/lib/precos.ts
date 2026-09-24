import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ItemPreco = {
  id: string;
  nome: string;
  preco_higienizacao: number;
  preco_impermeabilizacao: number | null;
  ativo: boolean;
  ordem: number;
};

const SELECT = "id, nome, preco_higienizacao, preco_impermeabilizacao, ativo, ordem";

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
};

export async function saveItemPreco(input: ItemPrecoInput, id?: string | null) {
  if (id) {
    const { error } = await supabase.from("tabela_precos_itens").update(input as never).eq("id", id);
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
  const { error } = await supabase.from("tabela_precos_itens").update({ ativo } as never).eq("id", id);
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
export async function itemPrecoEmUso(id: string) {
  const { count, error } = await supabase
    .from("quote_items")
    .select("id", { count: "exact", head: true })
    .eq("tabela_preco_item_id", id);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function excluirItemPreco(id: string) {
  const { error } = await supabase.from("tabela_precos_itens").delete().eq("id", id);
  if (error) throw error;
}
