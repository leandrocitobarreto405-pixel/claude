/**
 * Logo da empresa nos documentos em PDF. Pasta privada "empresa-logos", separada por empresa:
 * quem é da empresa vê; só o admin troca (RLS do armazenamento).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const PASTA_LOGOS = "empresa-logos";
const TIPOS: Record<string, "png" | "jpg"> = { "image/png": "png", "image/jpeg": "jpg" };
const MAX_BYTES = 2 * 1024 * 1024;

/** Envia (ou troca) a logo. Devolve o caminho, que ainda precisa ser salvo nos dados da empresa. */
export async function enviarLogo(empresaId: string, arquivo: File): Promise<string> {
  const ext = TIPOS[arquivo.type];
  if (!ext) throw new Error("Use uma imagem PNG ou JPG.");
  if (arquivo.size > MAX_BYTES) throw new Error("A logo pode ter no máximo 2 MB.");
  const caminho = `${empresaId}/logo.${ext}`;
  const { error } = await supabase.storage
    .from(PASTA_LOGOS)
    .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type, cacheControl: "60" });
  if (error) throw new Error("Não foi possível enviar a logo.");
  return caminho;
}

/** Endereço temporário (1 h) para mostrar a logo na tela. */
export function useLogoEmpresa(caminho: string | null | undefined, versao = 0) {
  return useQuery({
    queryKey: ["logo_empresa", caminho, versao],
    enabled: Boolean(caminho),
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(PASTA_LOGOS)
        .createSignedUrl(caminho!, 3600);
      if (error) return null;
      return data.signedUrl;
    },
  });
}
