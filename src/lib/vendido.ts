/**
 * Vendido pela DATA DO SERVIÇO (vale para todas as empresas). Cada visita conta no mês do seu
 * atendimento: a data da conclusão, se já foi feita; senão, a data agendada. O desconto da OS
 * (total da OS menor que a soma das visitas: Pix, cupom, ajuste) é repartido entre as visitas na
 * proporção do valor de cada uma, e a soma das visitas dá exatamente o total da OS. Remarcar muda a
 * data da própria visita (o valor muda de mês); visita cancelada sai; OS cancelada, excluída ou de
 * teste fica fora. Valor CHEIO (o que o cliente paga, inclusive a parte do parceiro nos itens
 * terceirizados), com o líquido do repasse ao lado.
 * Funções puras: quem busca os dados é vendido-dados.ts.
 */
import { effectiveVisitValue } from "@/lib/visit-value";

export type VisitaVendido = {
  id: string;
  status: string;
  scheduled_date: string | null;
  completion_date: string | null;
  visit_value: number | null;
  final_value: number | null;
  repasse_parceiro?: number | null;
  /** Saldo dispensado na visita (fica fora do A receber). */
  discount_amount?: number | null;
};

export type OsVendido = {
  id: string;
  os_number: string;
  total_gross_value: number | null;
  status: string;
  eh_teste: boolean;
  deleted_at: string | null;
  sale_date?: string | null;
  origem?: string | null;
  visitas: VisitaVendido[];
};

export type SituacaoVisita = "realizado" | "agendado" | "atrasado";

export type VisitaComValor = {
  visitaId: string;
  osId: string;
  osNumber: string;
  /** Data do serviço: conclusão (feita) ou agendada (por fazer). */
  data: string | null;
  situacao: SituacaoVisita;
  /** Valor cheio da visita com o desconto da OS repartido. */
  valor: number;
  /** Repasse ao parceiro nesta visita (itens terceirizados). */
  repasse: number;
  dispensado: number;
  origem: string | null;
};

const centavos = (n: number) => Math.round(Number(n || 0) * 100);
const reais = (c: number) => c / 100;

export function osConta(os: Pick<OsVendido, "eh_teste" | "deleted_at" | "status">): boolean {
  return !os.eh_teste && !os.deleted_at && os.status !== "Cancelada";
}

export function situacaoDaVisita(
  v: Pick<VisitaVendido, "status" | "scheduled_date">,
  hoje: string,
): SituacaoVisita {
  if (v.status === "Concluído") return "realizado";
  return (v.scheduled_date ?? "") < hoje ? "atrasado" : "agendado";
}

export function dataDoServico(
  v: Pick<VisitaVendido, "status" | "scheduled_date" | "completion_date">,
): string | null {
  const d = v.status === "Concluído" ? v.completion_date || v.scheduled_date : v.scheduled_date;
  return d ? d.slice(0, 10) : null;
}

/**
 * Valor de cada visita não cancelada da OS, com o desconto (ou acréscimo) do total da OS repartido
 * pelo valor das visitas. A última visita fica com a sobra dos centavos: a soma bate com o total.
 */
export function visitasComValor(os: OsVendido, hoje: string): VisitaComValor[] {
  const ativas = os.visitas
    .filter((v) => v.status !== "Cancelado")
    .sort(
      (a, b) =>
        (dataDoServico(a) ?? "").localeCompare(dataDoServico(b) ?? "") || a.id.localeCompare(b.id),
    );
  if (!ativas.length) return [];
  const total = centavos(Number(os.total_gross_value ?? 0));
  const bases = ativas.map((v) => centavos(effectiveVisitValue(v)));
  const soma = bases.reduce((s, b) => s + b, 0);
  let restante = total;
  return ativas.map((v, i) => {
    const ultimo = i === ativas.length - 1;
    const parte = ultimo
      ? restante
      : soma > 0
        ? Math.round((total * bases[i]!) / soma)
        : Math.round(total / ativas.length);
    restante -= parte;
    return {
      visitaId: v.id,
      osId: os.id,
      osNumber: os.os_number,
      data: dataDoServico(v),
      situacao: situacaoDaVisita(v, hoje),
      valor: reais(parte),
      repasse: Math.max(0, Number(v.repasse_parceiro ?? 0)),
      dispensado: Math.max(0, Number(v.discount_amount ?? 0)),
      origem: os.origem ?? null,
    };
  });
}

export type Intervalo = { de: string; ate: string };

export type Vendido = {
  /** Valor cheio das visitas do período (o que o cliente paga). */
  valor: number;
  /** O mesmo sem o repasse aos parceiros (só difere com item terceirizado). */
  liquido: number;
  realizado: number;
  agendado: number;
  atrasado: number;
  /** Visitas com data passada e não concluídas. */
  atrasadoQtd: number;
  /** OS diferentes com serviço no período. */
  quantidade: number;
  visitas: VisitaComValor[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Vendido do período pela data do serviço, aberto em Realizado + Agendado + Atrasado. */
export function vendidoNoPeriodo(oss: OsVendido[], periodo: Intervalo, hoje: string): Vendido {
  const visitas = oss
    .filter(osConta)
    .flatMap((os) => visitasComValor(os, hoje))
    .filter((v) => v.data !== null && v.data >= periodo.de && v.data <= periodo.ate);
  const somar = (lista: VisitaComValor[]) =>
    reais(lista.reduce((s, v) => s + centavos(v.valor), 0));
  const de = (s: SituacaoVisita) => visitas.filter((v) => v.situacao === s);
  const valor = somar(visitas);
  return {
    valor,
    liquido: r2(valor - visitas.reduce((s, v) => s + v.repasse, 0)),
    realizado: somar(de("realizado")),
    agendado: somar(de("agendado")),
    atrasado: somar(de("atrasado")),
    atrasadoQtd: de("atrasado").length,
    quantidade: new Set(visitas.map((v) => v.osId)).size,
    visitas,
  };
}

/** Vendido por semana (gráfico do Início), pela data do serviço. */
export function vendidoPorSemanaServico<S extends Intervalo>(
  oss: OsVendido[],
  semanas: S[],
  hoje: string,
): (S & { valor: number; quantidade: number })[] {
  return semanas.map((s) => {
    const v = vendidoNoPeriodo(oss, s, hoje);
    return { ...s, valor: v.valor, quantidade: v.quantidade };
  });
}

/** Vendido do período por origem da OS, do maior para o menor. */
export function vendidoPorOrigemServico(
  vendido: Vendido,
): { origem: string; valor: number; quantidade: number }[] {
  const mapa = new Map<string, { valor: number; os: Set<string> }>();
  for (const v of vendido.visitas) {
    const chave = v.origem?.trim() || "Sem origem";
    const acc = mapa.get(chave) ?? { valor: 0, os: new Set<string>() };
    acc.valor = r2(acc.valor + v.valor);
    acc.os.add(v.osId);
    mapa.set(chave, acc);
  }
  return [...mapa.entries()]
    .map(([origem, a]) => ({ origem, valor: a.valor, quantidade: a.os.size }))
    .sort((a, b) => b.valor - a.valor || a.origem.localeCompare(b.origem));
}
