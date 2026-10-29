/**
 * Gerente comercial: números da tela a partir das fichas (regras puras). Conversão por serviço e
 * origem, onde os leads somem, perdas em R$ por motivo, regras quebradas por quem atendeu e o
 * custo (real e estimado).
 */
import { NOME_REGRA, REGRAS, type Ficha, type Regra } from "./ficha";
import type { Fatos } from "./fatos";

export type FichaResumo = {
  grupo: "google" | "outras";
  status: "pendente" | "ok" | "erro";
  servico: string | null;
  origem: string | null;
  resultado: "vendeu" | "perdeu" | "sem_desfecho" | "sem_orcamento" | null;
  valorOrcado: number | null;
  valorVendido: number | null;
  nota: number | null;
  motivoSugerido: string | null;
  motivoRegistrado: string | null;
  quemAtendeu: string | null;
  custoUsd: number;
  ficha: Ficha | null;
  fatos: Fatos | null;
};

export type LinhaConversao = {
  chave: string;
  leads: number;
  comOrcamento: number;
  vendas: number;
  conversao: number;
  vendido: number;
};

/** Serviço principal: o primeiro antes da vírgula, sem detalhe depois de ":" ou "(". */
export function servicoPrincipal(s: string | null): string {
  const t = (s ?? "").split(",")[0]!.split(/[:(]/)[0]!.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Sem serviço";
}

export function conversaoPor(
  fichas: FichaResumo[],
  chave: (f: FichaResumo) => string,
): LinhaConversao[] {
  const m = new Map<string, LinhaConversao>();
  for (const f of fichas) {
    if (f.status !== "ok") continue;
    const k = chave(f);
    const l = m.get(k) ?? {
      chave: k,
      leads: 0,
      comOrcamento: 0,
      vendas: 0,
      conversao: 0,
      vendido: 0,
    };
    l.leads++;
    if (f.resultado !== "sem_orcamento") l.comOrcamento++;
    if (f.resultado === "vendeu") {
      l.vendas++;
      l.vendido += f.valorVendido ?? 0;
    }
    m.set(k, l);
  }
  return [...m.values()]
    .map((l) => ({ ...l, conversao: l.leads ? l.vendas / l.leads : 0 }))
    .sort((a, b) => b.leads - a.leads);
}

/** Onde os leads somem: quantos chegam a cada etapa. */
export function funil(fichas: FichaResumo[]) {
  const ok = fichas.filter((f) => f.status === "ok");
  const responderam = ok.filter((f) => (f.fatos?.mensagens.cliente ?? 0) > 1).length;
  const comOrcamento = ok.filter((f) => f.resultado !== "sem_orcamento").length;
  const vendas = ok.filter((f) => f.resultado === "vendeu").length;
  return [
    { etapa: "Chegaram", n: ok.length },
    { etapa: "Conversaram (mais de 1 mensagem)", n: responderam },
    { etapa: "Receberam orçamento", n: comOrcamento },
    { etapa: "Compraram", n: vendas },
  ];
}

/** Motivos de perda (registrado ou, sem registro, o sugerido) somando o valor orçado. */
export function perdasPorMotivo(fichas: FichaResumo[]) {
  const m = new Map<string, { motivo: string; n: number; valor: number }>();
  for (const f of fichas) {
    if (f.status !== "ok" || f.resultado === "vendeu" || f.resultado === "sem_orcamento") continue;
    const motivo = f.motivoRegistrado ?? f.motivoSugerido ?? "Sem motivo";
    const l = m.get(motivo) ?? { motivo, n: 0, valor: 0 };
    l.n++;
    l.valor += f.valorOrcado ?? 0;
    m.set(motivo, l);
  }
  return [...m.values()].sort((a, b) => b.valor - a.valor || b.n - a.n);
}

/** Regras: quantas vezes cada uma foi quebrada, separando Alice e equipe. */
export function regrasQuebradas(fichas: FichaResumo[]) {
  const linhas = REGRAS.map((r: Regra) => ({
    regra: r,
    nome: NOME_REGRA[r],
    alice: 0,
    equipe: 0,
    avaliadas: 0,
  }));
  for (const f of fichas) {
    for (const r of f.ficha?.regras ?? []) {
      const l = linhas.find((x) => x.regra === r.regra);
      if (!l || r.situacao === "nao_se_aplica") continue;
      l.avaliadas++;
      if (r.situacao === "quebrou" && r.quem === "alice") l.alice++;
      if (r.situacao === "quebrou" && r.quem === "equipe") l.equipe++;
    }
  }
  return linhas;
}

export function custos(fichas: FichaResumo[], totalPrevisto: number) {
  const feitas = fichas.filter((f) => f.status === "ok");
  const gasto = fichas.reduce((s, f) => s + f.custoUsd, 0);
  const medio = feitas.length ? gasto / feitas.length : 0;
  return {
    analisadas: feitas.length,
    gasto,
    medio,
    estimativaTotal: medio * totalPrevisto,
  };
}

export function mediaNota(fichas: FichaResumo[]): number | null {
  const n = fichas.filter((f) => f.status === "ok" && f.nota !== null).map((f) => f.nota as number);
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
}
