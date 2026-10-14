/**
 * Despesa "Quilometragem" criada pelas rotas (fechamento mensal ou lançamento diário,
 * reference_key "mileage:..."). Ela paga o mesmo km que o DRE já desconta como custo de
 * deslocamento (rateio nos serviços), então não entra de novo nas despesas pagas.
 */
export function despesaDeRota(e: { reference_key?: string | null }): boolean {
  return (e.reference_key ?? "").startsWith("mileage:");
}
