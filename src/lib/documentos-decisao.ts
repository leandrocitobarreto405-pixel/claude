/**
 * Qual documento a OS usa agora, decidido pelo servidor na hora (nunca pelo que a tela tem em
 * cache): PDF direto no app, modelos do Drive, ou Drive desligado/incompleto. Função pura.
 */
import type { ModoDocumento } from "@/lib/pdf/textos-padrao";

export type DecisaoDocumento = "pdf" | "drive" | "drive_desligado" | "drive_incompleto";

export type SituacaoDocumentos = {
  modo: ModoDocumento;
  drive: { enabled: boolean; autoGenerate: boolean; configured: boolean };
  decisao: DecisaoDocumento;
};

export const AVISO_DRIVE_DESLIGADO =
  "Documentos pelo Drive desligados — ative em Configurações › Documentos ou use PDF direto no app.";
export const AVISO_DRIVE_INCOMPLETO =
  "Modelos do Drive não configurados — informe os modelos e a pasta em Configurações › Documentos ou use PDF direto no app.";
export const AVISO_MODO_PDF =
  "Esta empresa usa o PDF direto no app: o documento não é gerado no Google Drive.";

export function decidirDocumentoOs(
  modo: ModoDocumento,
  drive: { enabled: boolean; configured: boolean },
): DecisaoDocumento {
  if (modo === "pdf") return "pdf";
  if (!drive.enabled) return "drive_desligado";
  if (!drive.configured) return "drive_incompleto";
  return "drive";
}

/** Ao criar a OS, o Drive só é chamado no modo Drive, ligado, configurado e com geração automática. */
export function geraNoDriveAoCriar(s: SituacaoDocumentos): boolean {
  return s.decisao === "drive" && s.drive.autoGenerate;
}

/** Aviso (sem erro vermelho) quando o Drive não vai ser usado; null quando pode gerar ou é PDF. */
export function avisoDocumento(decisao: DecisaoDocumento): string | null {
  if (decisao === "drive_desligado") return AVISO_DRIVE_DESLIGADO;
  if (decisao === "drive_incompleto") return AVISO_DRIVE_INCOMPLETO;
  return null;
}

/** Chave do cache do modo/situação: por empresa (admin da Nexa troca de empresa). */
export const CHAVE_MODO_DOCUMENTOS = ["modo-documentos"] as const;
export function chaveModoDocumentos(empresaId: string | null | undefined) {
  return [...CHAVE_MODO_DOCUMENTOS, empresaId ?? "sem-empresa"] as const;
}
