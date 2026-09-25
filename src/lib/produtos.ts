import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSetting } from "@/lib/data";

export type ProdutoTipo = "higienizacao" | "impermeabilizacao";

export const PRODUTO_TIPO_LABEL: Record<ProdutoTipo, string> = {
  higienizacao: "Higienização",
  impermeabilizacao: "Impermeabilização",
};

export type Produto = {
  id: string;
  nome: string;
  tipo_servico: ProdutoTipo;
  volume_embalagem_ml: number;
  preco_pago: number;
  custo_por_ml: number | null;
  estoque_atual_ml: number;
  ativo: boolean;
};

const SELECT =
  "id, nome, tipo_servico, volume_embalagem_ml, preco_pago, custo_por_ml, estoque_atual_ml, ativo";

/** Produtos cadastrados. `tipo` filtra por tipo de serviço. */
export function useProdutos(tipo?: ProdutoTipo | null, onlyActive = false) {
  return useQuery({
    queryKey: ["produtos", tipo ?? "todos", onlyActive],
    queryFn: async () => {
      let q = supabase.from("produtos").select(SELECT).order("nome");
      if (tipo) q = q.eq("tipo_servico", tipo);
      if (onlyActive) q = q.eq("ativo", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Produto[];
    },
  });
}

export type ProdutoInput = {
  nome: string;
  tipo_servico: ProdutoTipo;
  volume_embalagem_ml: number;
  preco_pago: number;
  estoque_atual_ml: number;
  ativo: boolean;
};

export async function saveProduto(input: ProdutoInput, id?: string | null) {
  if (id) {
    const { error } = await supabase.from("produtos").update(input).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase
    .from("produtos")
    .insert(input as never)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function setProdutoAtivo(id: string, ativo: boolean) {
  const { error } = await supabase.from("produtos").update({ ativo }).eq("id", id);
  if (error) throw error;
}

/** Grava o consumo e dá baixa no estoque, congelando o custo por ml do momento. */
export async function registrarConsumo(input: {
  workOrderId: string;
  visitId: string | null;
  produtoId: string;
  quantidadeMl: number;
}) {
  const { error } = await supabase.rpc("registrar_consumo_produto", {
    _work_order_id: input.workOrderId,
    _visit_id: input.visitId,
    _produto_id: input.produtoId,
    _quantidade_ml: input.quantidadeMl,
  } as never);
  if (error) throw error;
}

export type ConsumoRow = {
  id: string;
  produto_nome: string;
  quantidade_ml: number;
  custo_calculado: number;
  created_at: string;
};

/** Consumo de produtos lançado em uma OS. */
export function useConsumoDaOs(workOrderId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["os_produtos_utilizados", workOrderId ?? ""],
    enabled: Boolean(workOrderId) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("os_produtos_utilizados")
        .select("id, produto_nome, quantidade_ml, custo_calculado, created_at")
        .eq("work_order_id", workOrderId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as ConsumoRow[];
    },
  });
}

/** Detecta o tipo de produto pelo nome do serviço da visita. */
export function tipoProdutoDoServico(nomeServico?: string | null): ProdutoTipo | null {
  const s = (nomeServico ?? "").toLowerCase();
  if (s.includes("imperm")) return "impermeabilizacao";
  if (s.includes("higien")) return "higienizacao";
  return null;
}

export function custoPorLitro(p: Produto): number {
  return Number(p.custo_por_ml ?? 0) * 1000;
}

/** Preferência: exigir o consumo de produtos ao concluir cada serviço. */
export function useControleInsumos() {
  const q = useSetting<boolean>("controle_insumos_ativo", false);
  return { ativo: q.data === true, carregando: q.isLoading, refetch: q.refetch };
}
