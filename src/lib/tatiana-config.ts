/**
 * Projeção do gasto da Tatiana no mês (Configurações › Vendas › Tatiana, só a Nexa vê): média das
 * últimas 7 noites × noites que faltam até o fim do mês (a noite roda todo dia), mais o já gasto.
 */
export function projecaoDoMes(
  custosRecentes: number[],
  gastoAteAgora: number,
  hojeSP: string,
): number {
  const ultimas = custosRecentes.slice(0, 7);
  const media = ultimas.length ? ultimas.reduce((s, v) => s + v, 0) / ultimas.length : 0;
  const [a, m, d] = hojeSP.split("-").map(Number) as [number, number, number];
  const diasNoMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  // A noite de hoje ainda não rodou: conta de hoje até o último dia.
  const faltam = Math.max(diasNoMes - d + 1, 0);
  return Math.round((gastoAteAgora + media * faltam) * 100) / 100;
}
