// Faturas da assinatura (leitura pela tela). A empresa (admin) vê as dela; a Nexa vê todas.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Fatura = {
  id: string;
  empresa_id: string;
  competencia: string;
  valor: number;
  vencimento: string;
  status: string;
  forma: string;
  link_pagamento: string | null;
  pago_em: string | null;
};

export const CHAVE_FATURAS = ["faturas"] as const;

export function useFaturas(empresaId?: string | null, habilitado = true) {
  return useQuery({
    queryKey: [...CHAVE_FATURAS, empresaId ?? "todas"],
    enabled: habilitado,
    queryFn: async (): Promise<Fatura[]> => {
      let q = supabase
        .from("faturas")
        .select(
          "id, empresa_id, competencia, valor, vencimento, status, forma, link_pagamento, pago_em",
        )
        .order("competencia", { ascending: false })
        .limit(60);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((f) => ({ ...f, valor: Number(f.valor) }));
    },
  });
}
