/**
 * Temperatura do lead (29/10): a regra roda no banco (crm_recalcular_temperaturas, na varredura) e
 * grava a temperatura, o motivo e o retorno combinado. Aqui só os rótulos e o selo da tela.
 */

export const TEMPERATURAS = ["QUENTE", "MORNO", "FRIO"] as const;
export type Temperatura = (typeof TEMPERATURAS)[number];

export const ROTULO_TEMPERATURA: Record<Temperatura, string> = {
  QUENTE: "Quente",
  MORNO: "Morno",
  FRIO: "Frio",
};

export function ehTemperatura(t: string | null | undefined): t is Temperatura {
  return (TEMPERATURAS as readonly string[]).includes(t ?? "");
}

export function rotuloTemperatura(t: string | null | undefined): string {
  return ehTemperatura(t) ? ROTULO_TEMPERATURA[t] : "Frio";
}

/** Motivo gravado quando nenhuma regra decide e a sugestão da IA desempata. */
export const MOTIVO_IA = "IA: leitura da conversa";

/** A temperatura veio da IA (nenhuma regra decidiu ainda, ou o lead é antigo sem motivo). */
export function veioDaIa(motivo: string | null | undefined): boolean {
  return !motivo || motivo === MOTIVO_IA;
}

/** Selo "Retorno combinado (dd/mm)", vencido quando a data já passou. */
export function seloRetorno(
  retornoEm: string | null | undefined,
  agora: Date = new Date(),
): { rotulo: string; vencido: boolean } | null {
  if (!retornoEm) return null;
  const t = Date.parse(retornoEm);
  if (Number.isNaN(t)) return null;
  const dia = new Date(t).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
  return { rotulo: `Retorno combinado (${dia})`, vencido: t < agora.getTime() };
}
