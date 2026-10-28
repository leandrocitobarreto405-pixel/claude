// Alarme de crédito da IA no Painel Nexa: paradas abertas (aviso vermelho e sininho da Nexa).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { corpoParadaNexa, tituloParadaNexa } from "@/lib/alice/parada-ia";
import { paradasAbertasFn, type ParadaIa } from "@/lib/paradas-ia.functions";

export const CHAVE_PARADAS = ["nexa_paradas_ia"] as const;

/** Uma linha por provedor: desde o início mais antigo, empresas e conversas somadas. */
export function resumoDasParadas(paradas: ParadaIa[]) {
  return (["ia", "voz"] as const)
    .map((provedor) => {
      const lista = paradas.filter((p) => p.provedor === provedor);
      if (!lista.length) return null;
      const desde = new Date(Math.min(...lista.map((p) => Date.parse(p.inicio))));
      return {
        provedor,
        titulo: tituloParadaNexa(provedor, lista[0]!.causa, desde),
        corpo: corpoParadaNexa(
          provedor,
          lista.length,
          lista.reduce((s, p) => s + p.conversas, 0),
          lista[0]!.causa,
        ),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

export function useParadasIa() {
  const listar = useServerFn(paradasAbertasFn);
  return useQuery({ queryKey: CHAVE_PARADAS, queryFn: () => listar(), refetchInterval: 60_000 });
}
