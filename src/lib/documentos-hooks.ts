// Ganchos dos documentos da OS (modo da empresa, situação do Drive e quem pode baixar o PDF).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { trocarEmpresa, useContextoTenant } from "@/lib/tenant";
import { situacaoDocumentosFn } from "@/lib/os-docs.functions";
import { CHAVE_MODO_DOCUMENTOS, chaveModoDocumentos } from "@/lib/documentos-decisao";

/** Modo e situação dos documentos da empresa ativa (cache por empresa). */
export function useSituacaoDocumentos() {
  const ler = useServerFn(situacaoDocumentosFn);
  const { data: ctx } = useContextoTenant();
  const empresaId = ctx?.ativa?.empresa.id ?? null;
  return useQuery({
    queryKey: chaveModoDocumentos(empresaId),
    queryFn: () => ler(),
    enabled: Boolean(empresaId),
    staleTime: 30_000,
  });
}

/** "drive" | "pdf" (undefined enquanto carrega). */
export function useModoDocumentos() {
  const q = useSituacaoDocumentos();
  return { ...q, data: q.data?.modo };
}

/** Depois de salvar Configurações › Documentos (modo ou Drive): todas as telas releem. */
export function useInvalidarDocumentos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [...CHAVE_MODO_DOCUMENTOS] });
}

/** Troca de empresa sem levar o modo da anterior. */
export function useTrocarEmpresa() {
  const qc = useQueryClient();
  return (empresaId: string, destino?: string) => {
    qc.removeQueries({ queryKey: [...CHAVE_MODO_DOCUMENTOS] });
    trocarEmpresa(empresaId, destino);
  };
}

/** Técnico não vê valores: não baixa o PDF da OS. */
export function usePodeBaixarOs() {
  const { data: ctx } = useContextoTenant();
  return Boolean(ctx?.souNexa || (ctx?.ativa?.papel && ctx.ativa.papel !== "tecnico"));
}
