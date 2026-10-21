/**
 * Logo e assinatura da empresa (documentos em PDF e avatar no app). Pasta privada
 * "empresa-logos", separada por empresa: quem é da empresa vê; só o admin troca (RLS do
 * armazenamento). Tudo é guardado como PNG: `<empresa>/logo.png` e `<empresa>/assinatura.png`.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { paraPng } from "@/lib/imagem-png";

export const PASTA_LOGOS = "empresa-logos";
const MAX_BYTES = 2 * 1024 * 1024;

async function subir(caminho: string, arquivo: File): Promise<string> {
  if (arquivo.size > MAX_BYTES)
    throw new Error("A imagem ficou acima de 2 MB mesmo convertida. Use uma menor.");
  const { error } = await supabase.storage
    .from(PASTA_LOGOS)
    .upload(caminho, arquivo, { upsert: true, contentType: "image/png", cacheControl: "60" });
  if (error) throw new Error("Não foi possível enviar a imagem.");
  return caminho;
}

/** Envia (ou troca) a logo: JPG, PNG, WebP, HEIC ou PDF viram PNG. Devolve o caminho. */
export async function enviarLogo(empresaId: string, arquivo: File): Promise<string> {
  const png = await paraPng(arquivo, { maxLado: 1200, nome: "logo.png" });
  return subir(`${empresaId}/logo.png`, png);
}

/** Envia (ou troca) a assinatura (PNG com fundo transparente de preferência). */
export async function enviarAssinatura(empresaId: string, arquivo: File): Promise<string> {
  const png = await paraPng(arquivo, { maxLado: 900, nome: "assinatura.png" });
  return subir(`${empresaId}/assinatura.png`, png);
}

async function urlAssinada(caminho: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(PASTA_LOGOS).createSignedUrl(caminho, 3600);
  return error ? null : data.signedUrl;
}

/** Endereço temporário (1 h) de uma imagem da pasta da empresa, para mostrar na tela. */
export function useImagemEmpresa(caminho: string | null | undefined) {
  return useQuery({
    queryKey: ["logo_empresa", "caminho", caminho],
    enabled: Boolean(caminho),
    staleTime: 30 * 60_000,
    queryFn: () => urlAssinada(caminho!),
  });
}

/**
 * Logo da empresa pelo id (avatar no cabeçalho, no seletor e no Início): tenta o PNG e, para
 * logos antigas, o JPG. Sem logo, null (a tela mostra as iniciais).
 */
export function useLogoEmpresa(empresaId: string | null | undefined) {
  return useQuery({
    queryKey: ["logo_empresa", "avatar", empresaId],
    enabled: Boolean(empresaId),
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async () =>
      (await urlAssinada(`${empresaId}/logo.png`)) ?? (await urlAssinada(`${empresaId}/logo.jpg`)),
  });
}

/** Depois de trocar logo ou assinatura: todas as telas releem as imagens. */
export function useInvalidarImagensEmpresa() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["logo_empresa"] });
}
