// Regras da tela Marketing (sem acesso a banco, para poder testar).
import type { TomChip } from "@/components/nexa";

type RelatorioLinha = {
  campanha_id: string | null;
  mes_ref: string | null;
  enviados: number | null;
  respostas: number | null;
  vendas: number | null;
  valor_vendido: number | null;
};

/** Resultados do mês (campanhas do calendário + gatilhos com mes_ref no mês). */
export function resultadosDoMes(relatorio: RelatorioLinha[], mes: string) {
  const doMes = relatorio.filter((r) => (r.mes_ref ?? "").slice(0, 7) === mes.slice(0, 7));
  const soma = (f: (r: RelatorioLinha) => number | null) =>
    doMes.reduce((s, r) => s + Number(f(r) ?? 0), 0);
  return {
    enviados: soma((r) => r.enviados),
    respostas: soma((r) => r.respostas),
    vendas: soma((r) => r.vendas),
    valor: soma((r) => r.valor_vendido),
  };
}

const SITUACAO: Record<string, { rotulo: string; tom: TomChip }> = {
  rascunho: { rotulo: "Rascunho", tom: "neutro" },
  aguardando_aprovacao: { rotulo: "Aprovar", tom: "atencao" },
  aprovada: { rotulo: "Agendada", tom: "sucesso" },
  enviando: { rotulo: "Enviando", tom: "sucesso" },
  pausada: { rotulo: "Pausada", tom: "problema" },
  concluida: { rotulo: "Concluída", tom: "neutro" },
  recusada: { rotulo: "Recusada", tom: "neutro" },
  expirada: { rotulo: "Expirou", tom: "neutro" },
  bloqueada: { rotulo: "Bloqueada", tom: "problema" },
};

export function chipDaCampanha(status: string): { rotulo: string; tom: TomChip } {
  return SITUACAO[status] ?? { rotulo: status, tom: "neutro" };
}

type CampanhaCal = {
  id: string;
  nome: string;
  tipo: string;
  status: string;
  datas_disparo: string[] | null;
  estimativa: unknown;
};

export type ItemCalendario = {
  id: string;
  /** Data do primeiro disparo (AAAA-MM-DD). */
  data: string;
  nome: string;
  contatos: number | null;
  chip: { rotulo: string; tom: TomChip };
};

/**
 * Próximas campanhas do calendário: as que ainda vão sair (primeiro disparo de hoje em diante,
 * até 60 dias) e as que estão em andamento, por data.
 */
export function proximasCampanhas(campanhas: CampanhaCal[], hoje: string): ItemCalendario[] {
  const limite = new Date(`${hoje}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + 60);
  const ate = limite.toISOString().slice(0, 10);
  return campanhas
    .filter((c) => c.tipo === "calendario")
    .map((c) => {
      const datas = [...(c.datas_disparo ?? [])].sort();
      const est = (c.estimativa ?? {}) as { total?: number };
      return {
        id: c.id,
        data: datas[0] ?? "",
        ultima: datas[datas.length - 1] ?? "",
        nome: c.nome,
        contatos: typeof est.total === "number" ? est.total : null,
        chip: chipDaCampanha(c.status),
        status: c.status,
      };
    })
    .filter(
      (c) =>
        c.data &&
        !["recusada", "expirada"].includes(c.status) &&
        (["enviando", "pausada"].includes(c.status) || (c.ultima >= hoje && c.data <= ate)),
    )
    .sort((a, b) => a.data.localeCompare(b.data))
    .map(({ id, data, nome, contatos, chip }) => ({ id, data, nome, contatos, chip }));
}

/** "17 out" */
export function diaMesCurto(iso: string): string {
  const meses = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  return `${Number(iso.slice(8, 10))} ${meses[Number(iso.slice(5, 7)) - 1] ?? ""}`;
}
