import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listarAvisos } from "@/lib/avisos.functions";
import { intervalo } from "@/lib/ritmo";

export const CHAVE_AVISOS = ["avisos"] as const;

/** Avisos de hoje, do mais urgente para o menos (a lista que antes era a tela Avisos). */
export function useAvisos(ligado = true) {
  const listarFn = useServerFn(listarAvisos);
  return useQuery({
    queryKey: CHAVE_AVISOS,
    queryFn: () => listarFn(),
    enabled: ligado,
    refetchInterval: intervalo(60_000),
  });
}
