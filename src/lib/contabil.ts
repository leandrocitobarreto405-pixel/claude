/**
 * Regras da área da contadora (sem acesso a banco, para poder testar): mês, situações da nota,
 * arquivos aceitos e a cópia para o Drive com nova tentativa.
 */

/** Situações da nota que a contadora pode marcar. "Não emitir" aparece como "Não necessária". */
export type AcaoNota = "emitida" | "cancelada" | "nao_necessaria";
export const STATUS_DA_ACAO: Record<AcaoNota, string> = {
  emitida: "Emitida",
  cancelada: "Cancelada",
  nao_necessaria: "Não emitir",
};
export const ROTULO_STATUS: Record<string, string> = {
  Pendente: "Pendente",
  Solicitada: "Solicitada",
  Emitida: "Emitida",
  Cancelada: "Cancelada",
  "Não emitir": "Não necessária",
  "Sem pedido": "Sem pedido",
};

/** Primeiro e último dia do mês "AAAA-MM". */
export function periodoDoMes(mes: string): { de: string; ate: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error("Mês inválido.");
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** Arquivo de nota ou comprovante: PDF, imagem ou XML, até 10 MB. */
export const TIPOS_ACEITOS: Record<string, string> = {
  pdf: "application/pdf",
  xml: "application/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
export const TAMANHO_MAXIMO = 10 * 1024 * 1024;

export function validarArquivo(
  nome: string,
  tamanho: number,
  so?: "pdf" | "xml",
): { ok: true; extensao: string; tipo: string } | { ok: false; motivo: string } {
  const extensao = (nome.split(".").pop() ?? "").toLowerCase();
  const tipo = TIPOS_ACEITOS[extensao];
  if (!tipo || (so && extensao !== so && !(so === "pdf" && tipo.startsWith("image/"))))
    return {
      ok: false,
      motivo: so === "xml" ? "Envie o XML da nota." : "Envie PDF, imagem (PNG/JPG) ou XML.",
    };
  if (!(tamanho > 0)) return { ok: false, motivo: "Arquivo vazio." };
  if (tamanho > TAMANHO_MAXIMO) return { ok: false, motivo: "Arquivo maior que 10 MB." };
  return { ok: true, extensao, tipo };
}

/** Nome seguro para o caminho no Storage. */
export function nomeSeguro(nome: string): string {
  return nome.replace(/[^\w.-]+/g, "_").slice(-80) || "arquivo";
}

/** Validação do que a contadora marca na nota. */
export function validarAcaoNota(a: {
  acao: AcaoNota;
  numero?: string | null;
  data?: string | null;
  motivo?: string | null;
  temArquivo: boolean;
}): string | null {
  if (a.acao === "emitida") {
    if (!a.numero?.trim()) return "Informe o número da nota.";
    if (!a.data || !/^\d{4}-\d{2}-\d{2}$/.test(a.data)) return "Informe a data de emissão.";
    if (!a.temArquivo) return "Anexe o PDF ou o XML da nota antes de marcar como emitida.";
  }
  if (a.acao === "cancelada" && !a.motivo?.trim()) return "Informe o motivo do cancelamento.";
  return null;
}

// ------------------------------------------------------------------ Drive com nova tentativa

export const MAX_TENTATIVAS_DRIVE = 8;

export type SituacaoDrive = "pendente" | "copiada" | "sem_drive" | "erro";

export type ResultadoDrive = {
  situacao: SituacaoDrive;
  tentativas: number;
  erro: string | null;
  url: string | null;
};

/**
 * Faz uma tentativa de cópia. Drive não configurado: "sem_drive" (não tenta de novo). Falha:
 * continua "pendente" até MAX_TENTATIVAS_DRIVE e depois "erro" (o admin vê e pode reenviar).
 */
export async function tentarCopiaDrive(
  tentativasAntes: number,
  copiar: () => Promise<{ url: string } | "sem_drive">,
): Promise<ResultadoDrive> {
  const tentativas = tentativasAntes + 1;
  try {
    const r = await copiar();
    if (r === "sem_drive") return { situacao: "sem_drive", tentativas, erro: null, url: null };
    return { situacao: "copiada", tentativas, erro: null, url: r.url };
  } catch (e) {
    const erro = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    return {
      situacao: tentativas >= MAX_TENTATIVAS_DRIVE ? "erro" : "pendente",
      tentativas,
      erro,
      url: null,
    };
  }
}

/** Linhas do CSV (separador ";" e vírgula decimal, como o Excel em português abre). */
export function csv(linhas: Array<Array<string | number | null | undefined>>): string {
  const celula = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}
