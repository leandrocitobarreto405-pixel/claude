import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { classificacaoDosLeadsFn } from "@/lib/classificacao-lead.functions";

/** Classificação da Tatiana de todos os leads lidos da empresa (lead → 1 a 9). */
export function useClassificacoes(ligado = true) {
  const ler = useServerFn(classificacaoDosLeadsFn);
  const q = useQuery({
    queryKey: ["classificacao-leads"],
    queryFn: () => ler({ data: { ids: null } }),
    enabled: ligado,
    staleTime: 5 * 60_000,
  });
  return q.data ?? {};
}
