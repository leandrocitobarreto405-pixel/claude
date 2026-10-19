// Ganchos dos documentos em PDF (modo da empresa e quem pode baixar o PDF da OS).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useContextoTenant } from "@/lib/tenant";
import { modoDocumentosFn } from "@/lib/documentos.functions";

/** "drive" | "pdf" (undefined enquanto carrega). */
export function useModoDocumentos() {
  const ler = useServerFn(modoDocumentosFn);
  return useQuery({
    queryKey: ["modo-documentos"],
    queryFn: () => ler(),
    staleTime: 5 * 60_000,
    select: (r) => r.modo,
  });
}

/** Técnico não vê valores: não baixa o PDF da OS. */
export function usePodeBaixarOs() {
  const { data: ctx } = useContextoTenant();
  return Boolean(ctx?.souNexa || (ctx?.ativa?.papel && ctx.ativa.papel !== "tecnico"));
}
