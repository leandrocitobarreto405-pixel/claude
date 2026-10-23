// Situação da assinatura da empresa (decisão F): ok, aviso (atraso na carência), somente leitura
// ou bloqueada. O aviso no topo do app usa isto.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SituacaoAssinatura = {
  situacao?: "ok" | "aviso" | "somente_leitura" | "bloqueada";
  dias_para_somente_leitura?: number | null;
};

export function useSituacaoAssinatura(empresaId: string | null | undefined) {
  return useQuery({
    queryKey: ["situacao_assinatura", empresaId],
    enabled: Boolean(empresaId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SituacaoAssinatura> => {
      const { data, error } = await supabase.rpc("situacao_assinatura", {
        _emp: empresaId as string,
      });
      if (error) return {};
      return (data ?? {}) as SituacaoAssinatura;
    },
  });
}

export function textoAvisoAssinatura(s: SituacaoAssinatura | undefined): string | null {
  if (s?.situacao === "aviso") {
    const d = s.dias_para_somente_leitura ?? 0;
    return d <= 1
      ? "Assinatura em atraso: a partir de amanhã o app fica só para consulta. Fale com a Nexa para regularizar."
      : `Assinatura em atraso: em ${d} dias o app fica só para consulta. Fale com a Nexa para regularizar.`;
  }
  if (s?.situacao === "somente_leitura")
    return "Assinatura em atraso há mais de 7 dias: o app está só para consulta (dá para ver tudo, mas não criar nem enviar). Fale com a Nexa para regularizar.";
  return null;
}
