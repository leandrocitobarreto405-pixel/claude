/**
 * Foto dos técnicos (a Alice manda ao cliente junto com o nome). Pasta privada "equipe-fotos",
 * separada por empresa: quem é da empresa vê; só o admin troca (RLS do armazenamento).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const PASTA_FOTOS = "equipe-fotos";
const TIPOS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_BYTES = 5 * 1024 * 1024;

/** Envia (ou troca) a foto do técnico e grava o caminho no cadastro. Devolve o caminho. */
export async function enviarFotoTecnico(
  empresaId: string,
  tecnicoId: string,
  arquivo: File,
): Promise<string> {
  const ext = TIPOS[arquivo.type];
  if (!ext) throw new Error("Use uma foto JPG, PNG ou WEBP.");
  if (arquivo.size > MAX_BYTES) throw new Error("A foto pode ter no máximo 5 MB.");
  const caminho = `${empresaId}/tecnicos/${tecnicoId}.${ext}`;
  const { error } = await supabase.storage
    .from(PASTA_FOTOS)
    .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type, cacheControl: "60" });
  if (error) throw new Error("Não foi possível enviar a foto.");
  const { error: e2 } = await supabase
    .from("technicians")
    .update({ foto_path: caminho })
    .eq("id", tecnicoId);
  if (e2) throw new Error("A foto foi enviada, mas não deu para salvar no cadastro.");
  return caminho;
}

/** Endereço temporário (1 h) para mostrar a foto na tela. */
export function useFotoTecnico(caminho: string | null | undefined, versao = 0) {
  return useQuery({
    queryKey: ["foto_tecnico", caminho, versao],
    enabled: Boolean(caminho),
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(PASTA_FOTOS)
        .createSignedUrl(caminho!, 3600);
      if (error) return null;
      return data.signedUrl;
    },
  });
}
