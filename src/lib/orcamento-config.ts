/** Regras de orçamento da empresa ativa (tela): leitura e gravação (admin). */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { REGRAS_DESLIGADAS, regrasDaLinha, type RegrasOrcamento } from "@/lib/orcamento-regras";
import { useContextoTenant } from "@/lib/tenant";

export type LinhaConfigOrcamento = {
  desconto_adicional_ligado: boolean;
  desconto_adicional_pct: number;
  desconto_categorias: string[];
  minimo_cadeiras: number | null;
  sujidade_ligado: boolean;
  sujidade_pct: number;
  distancia_ligado: boolean;
  distancia_sem_acrescimo_km: number | null;
  distancia_limite_km: number | null;
  distancia_pct: number;
  vitrine_ligada: boolean;
  boas_vindas_pct: number;
  pix_pct: number;
  arredondamento: "dezena_5" | "noventa";
  parcelas_max: number | null;
  validade_dias: number | null;
};

export const CONFIG_PADRAO: LinhaConfigOrcamento = {
  desconto_adicional_ligado: false,
  desconto_adicional_pct: 40,
  desconto_categorias: ["sofa", "colchao"],
  minimo_cadeiras: null,
  sujidade_ligado: false,
  sujidade_pct: 10,
  distancia_ligado: false,
  distancia_sem_acrescimo_km: null,
  distancia_limite_km: null,
  distancia_pct: 10,
  vitrine_ligada: false,
  boas_vindas_pct: 20,
  pix_pct: 10,
  arredondamento: "dezena_5",
  parcelas_max: null,
  validade_dias: null,
};

const CAMPOS = Object.keys(CONFIG_PADRAO).join(", ");

export function useConfigOrcamento() {
  const { data: tenant } = useContextoTenant();
  const empresaId = tenant?.ativa?.empresa.id ?? null;
  const q = useQuery({
    queryKey: ["orcamento-config", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orcamento_configuracoes")
        .select(CAMPOS)
        .eq("empresa_id", empresaId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as LinhaConfigOrcamento | null;
    },
  });
  const linha = q.data ?? null;
  const regras: RegrasOrcamento = useMemo(
    () =>
      q.data ? regrasDaLinha(q.data as unknown as Record<string, unknown>) : REGRAS_DESLIGADAS,
    [q.data],
  );
  return { linha, regras, carregando: q.isLoading, empresaId };
}

export function useSalvarConfigOrcamento() {
  const qc = useQueryClient();
  return async (empresaId: string, linha: LinhaConfigOrcamento) => {
    const { error } = await supabase
      .from("orcamento_configuracoes")
      .upsert({ empresa_id: empresaId, ...linha, updated_at: new Date().toISOString() } as never, {
        onConflict: "empresa_id",
      });
    if (error) throw new Error("Não foi possível salvar as regras do orçamento.");
    await qc.invalidateQueries({ queryKey: ["orcamento-config"] });
    await qc.invalidateQueries({ queryKey: ["textos-empresa"] });
  };
}
