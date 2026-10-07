/**
 * Fotos e vídeos da OS: formatos aceitos, limite de tamanho e as mensagens de erro que aparecem
 * para a equipe. Vale no celular (antes de enviar) e no servidor (ao abrir o envio).
 */

/** Até 2 GB por arquivo (vídeo longo do iPhone em 4K passa de 500 MB). */
export const LIMITE_MIDIA = 2 * 1024 ** 3;
/** Pedaço de cada envio ao Google Drive (múltiplo de 256 KB, como o Google pede). */
export const PEDACO_ENVIO = 8 * 1024 * 1024;

const POR_EXTENSAO: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mov: "video/quicktime",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  "3gp": "video/3gpp",
  webm: "video/webm",
};

export const FORMATOS_TEXTO = "JPG, PNG, HEIC, MOV ou MP4";
/** Para o seletor de arquivos: inclui as extensões, porque o iPhone às vezes não manda o tipo. */
export const ACEITA_MIDIA = `image/*,video/*,${Object.keys(POR_EXTENSAO)
  .map((e) => `.${e}`)
  .join(",")}`;

export function extensao(nome: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(nome.trim());
  return m ? m[1]!.toLowerCase() : "";
}

/** Tipo do arquivo para o Drive (pelo navegador ou, se vier vazio, pela extensão). */
export function tipoDaMidia(nome: string, tipo: string | null | undefined): string | null {
  const t = (tipo ?? "").toLowerCase();
  if (t.startsWith("image/") || t.startsWith("video/")) return t;
  return POR_EXTENSAO[extensao(nome)] ?? null;
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  if (bytes >= 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type ArquivoValidado = { ok: true; tipo: string } | { ok: false; motivo: string };

export function validarMidia(nome: string, tipo: string | null | undefined, tamanho: number) {
  const mime = tipoDaMidia(nome, tipo);
  if (!mime) {
    const ext = extensao(nome);
    return {
      ok: false,
      motivo: `Formato ${ext ? `.${ext} ` : ""}não aceito. Envie foto ou vídeo (${FORMATOS_TEXTO}).`,
    } satisfies ArquivoValidado;
  }
  if (tamanho <= 0) return { ok: false, motivo: "O arquivo está vazio." } satisfies ArquivoValidado;
  if (tamanho > LIMITE_MIDIA)
    return {
      ok: false,
      motivo: `Arquivo grande demais (${tamanhoLegivel(tamanho)}). O limite é ${tamanhoLegivel(LIMITE_MIDIA)}.`,
    } satisfies ArquivoValidado;
  return { ok: true, tipo: mime } satisfies ArquivoValidado;
}

/** Motivo de uma resposta de erro do Google Drive, para a equipe entender o que fazer. */
export function motivoDoDrive(status: number, corpo = ""): string {
  const c = corpo.toLowerCase();
  if (c.includes("storagequotaexceeded") || c.includes("quotaexceeded"))
    return "O Google Drive da empresa está sem espaço. Libere espaço ou aumente o plano.";
  if (status === 401)
    return "A conta Google da empresa precisa ser conectada de novo (Configurações → Conta Google).";
  if (status === 403) return "A conta Google da empresa não tem permissão na pasta desta OS.";
  if (status === 404) return "O envio expirou ou a pasta da OS não existe mais. Envie de novo.";
  if (status === 413) return "Arquivo grande demais para o Google Drive.";
  if (status === 429)
    return "O Google Drive pediu para esperar um pouco. Tente de novo em instantes.";
  if (status >= 500) return "O Google Drive está instável agora. Tente de novo em instantes.";
  return `O Google Drive recusou o arquivo (${status}).`;
}

/** Posição já recebida pelo Google, a partir do cabeçalho Range ("bytes=0-1234"). */
export function bytesRecebidos(range: string | null | undefined): number {
  const m = /bytes=0-(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) + 1 : 0;
}
