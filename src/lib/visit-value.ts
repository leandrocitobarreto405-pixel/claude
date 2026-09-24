/**
 * Valor efetivo de um atendimento.
 *
 * Atendimentos concluídos antes do ajuste de itens ficaram com valor final zerado.
 * Zero em atendimento com valor de visita positivo é tratado como "não informado",
 * então o valor da visita é usado como base financeira.
 */
export function effectiveVisitValue(visit: {
  final_value?: number | string | null;
  visit_value?: number | string | null;
}): number {
  const final = Number(visit.final_value ?? 0);
  if (Number.isFinite(final) && final > 0) return final;
  const scheduled = Number(visit.visit_value ?? 0);
  return Number.isFinite(scheduled) ? scheduled : 0;
}
