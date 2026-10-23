// Asaas (decisão G): partes puras, sem rede e sem chave, para poder testar. O cliente HTTP fica em
// asaas.server.ts; as chaves ficam só no Secret Manager (ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN).

export type AmbienteAsaas = "sandbox" | "producao";

/** Sandbox é o padrão: produção só com ASAAS_AMBIENTE=producao. */
export function ambienteAsaas(valor: string | undefined): AmbienteAsaas {
  return valor?.trim().toLowerCase() === "producao" ? "producao" : "sandbox";
}

export function baseUrlAsaas(ambiente: AmbienteAsaas): string {
  return ambiente === "producao" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

/** O que o banco precisa de um aviso (webhook) do Asaas; null quando não é de cobrança. */
export function lerAvisoAsaas(corpo: unknown): {
  eventoId: string;
  evento: string;
  cobrancaId: string;
} | null {
  if (!corpo || typeof corpo !== "object") return null;
  const c = corpo as Record<string, unknown>;
  const evento = typeof c["event"] === "string" ? c["event"] : "";
  const pagamento =
    c["payment"] && typeof c["payment"] === "object"
      ? (c["payment"] as Record<string, unknown>)
      : null;
  const cobrancaId = typeof pagamento?.["id"] === "string" ? pagamento["id"] : "";
  if (!evento.startsWith("PAYMENT_") || !cobrancaId) return null;
  // Versões novas mandam o id do evento; nas antigas, o mesmo aviso repetido tem os mesmos campos.
  const eventoId =
    typeof c["id"] === "string" && c["id"]
      ? c["id"]
      : [evento, cobrancaId, pagamento?.["status"] ?? "", c["dateCreated"] ?? ""].join(":");
  return { eventoId, evento, cobrancaId };
}

/** "2026-11" → "2026-11-01" (competência da fatura); null se inválido. */
export function competenciaDoMes(mes: string): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mes.trim());
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** "Nexa OS · Básico · 11/2026". */
export function descricaoFatura(plano: string, competencia: string): string {
  const [ano, mes] = competencia.split("-");
  return `Nexa OS · ${plano} · ${mes}/${ano}`;
}

/** Fatura só com valor: mensalidade vazia ou R$ 0 não gera (decisão de 23/10/2026). */
export function motivoSemFatura(
  mensalidade: number | null,
  status: string | null | undefined,
): string | null {
  if (!status) return "Empresa sem assinatura.";
  if (status === "cancelada") return "Assinatura cancelada.";
  if (mensalidade === null || !(mensalidade > 0))
    return "Mensalidade não definida (vazia ou R$ 0): não gera fatura.";
  return null;
}

export const STATUS_FATURA: Record<string, string> = {
  pendente: "Em aberto",
  paga: "Paga",
  vencida: "Vencida",
  cancelada: "Cancelada",
  estornada: "Estornada",
};
