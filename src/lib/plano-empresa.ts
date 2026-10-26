// Plano da empresa aberta (recursos, limite de usuários e planos públicos), para a trava da tela.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useContextoTenant } from "@/lib/tenant";
import type { PlanoDaEmpresa } from "@/lib/recursos";

export const CHAVE_PLANO_EMPRESA = ["plano_da_empresa"] as const;

export function usePlanoDaEmpresa() {
  const { data: ctx } = useContextoTenant();
  const empresaId = ctx?.ativa?.empresa.id ?? null;
  return useQuery({
    queryKey: [...CHAVE_PLANO_EMPRESA, empresaId],
    enabled: Boolean(empresaId) && !ctx?.painelNexa,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PlanoDaEmpresa | null> => {
      const { data, error } = await supabase.rpc("plano_da_empresa" as never);
      if (error) throw error;
      const p = data as unknown as PlanoDaEmpresa | null;
      if (!p) return null;
      return {
        ...p,
        recursos: p.recursos ?? {},
        planos: (p.planos ?? []).map((x) => ({
          ...x,
          preco_mensal: x.preco_mensal === null ? null : Number(x.preco_mensal),
        })),
      };
    },
  });
}
