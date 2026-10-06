/**
 * Comissão da Nexa.
 *
 * As atendentes da Nexa (Carol, Maria…) vendem para as empresas clientes. Cada empresa paga à
 * Nexa a comissão do contrato (ex.: Turbine 3%, demais 5%) sobre o que recebeu dos serviços
 * vendidos por elas — é a mesma "Comissão Nexa" do DRE da empresa (percentual gravado na OS).
 * A Nexa repassa às atendentes um percentual próprio (ex.: 3%) sobre o que cada uma vendeu,
 * somando todas as empresas.
 */

export type AlocacaoComissao = {
  salesperson: string;
  salespersonNexa: boolean;
  salespersonIa: boolean;
  received: number;
  commissionPct: number;
};

export type ResumoNexaEmpresa = {
  /** Recebido dos serviços vendidos pelas atendentes da Nexa (inclui a IA). */
  recebido: number;
  /** O que a empresa paga à Nexa (soma da comissão de cada OS, como no DRE). */
  comissao: number;
  /** Percentuais usados nas OS (normalmente um só, o do contrato). */
  percentuais: number[];
  porVendedora: Record<string, { recebido: number; comissao: number; ia: boolean }>;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function resumoNexaDaEmpresa(alocacoes: AlocacaoComissao[]): ResumoNexaEmpresa {
  const out: ResumoNexaEmpresa = { recebido: 0, comissao: 0, percentuais: [], porVendedora: {} };
  for (const a of alocacoes) {
    if (!a.salespersonNexa || a.received === 0) continue;
    const comissao = r2((a.received * a.commissionPct) / 100);
    out.recebido = r2(out.recebido + a.received);
    out.comissao = r2(out.comissao + comissao);
    if (a.commissionPct > 0 && !out.percentuais.includes(a.commissionPct))
      out.percentuais.push(a.commissionPct);
    const v = (out.porVendedora[a.salesperson] ??= {
      recebido: 0,
      comissao: 0,
      ia: a.salespersonIa,
    });
    v.recebido = r2(v.recebido + a.received);
    v.comissao = r2(v.comissao + comissao);
  }
  out.percentuais.sort((a, b) => a - b);
  return out;
}

/** "5%" ou "3% e 5%" (sem casas quando inteiro). */
export function textoPercentuais(pcts: number[]): string {
  const f = (n: number) => `${String(Number(n.toFixed(2))).replace(".", ",")}%`;
  if (!pcts.length) return "";
  if (pcts.length === 1) return f(pcts[0]!);
  return `${pcts.slice(0, -1).map(f).join(", ")} e ${f(pcts[pcts.length - 1]!)}`;
}

export type RepasseAtendente = {
  nome: string;
  recebido: number;
  porEmpresa: Array<{ empresa: string; recebido: number }>;
  repasse: number;
};

/**
 * Repasse da Nexa a cada atendente: o que ela vendeu (recebido) em todas as empresas × o
 * percentual da atendente. A mesma pessoa em empresas diferentes é juntada pelo nome.
 * A IA não recebe repasse.
 */
export function repasseAtendentes(
  empresas: Array<{ nome: string; resumo: ResumoNexaEmpresa }>,
  pctAtendente: number,
): RepasseAtendente[] {
  const mapa = new Map<string, RepasseAtendente>();
  for (const e of empresas) {
    for (const [nome, v] of Object.entries(e.resumo.porVendedora)) {
      if (v.ia || v.recebido === 0) continue;
      const chave = nome.trim().toLocaleLowerCase("pt-BR");
      const a = mapa.get(chave) ?? { nome: nome.trim(), recebido: 0, porEmpresa: [], repasse: 0 };
      a.recebido = r2(a.recebido + v.recebido);
      a.porEmpresa.push({ empresa: e.nome, recebido: v.recebido });
      mapa.set(chave, a);
    }
  }
  return [...mapa.values()]
    .map((a) => ({ ...a, repasse: r2((a.recebido * pctAtendente) / 100) }))
    .sort((a, b) => b.recebido - a.recebido);
}
