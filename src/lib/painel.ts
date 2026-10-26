// Regras do painel financeiro do Início (sem acesso a banco, para poder testar).
// Quem busca os números é painel.functions.ts (no servidor); aqui ficam períodos, agrupamentos,
// variações e a lista de atalhos.
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Coins,
  FileSpreadsheet,
  Filter,
  Globe,
  HandCoins,
  MessageCircle,
  Receipt,
  Send,
  Settings,
  Undo2,
} from "lucide-react";
import { addDaysISO, monthEnd, monthStart, shiftMonth, weekEnd, weekStart } from "@/lib/format";
import { podeAcessar, type Papel } from "@/lib/tenant";

export type Periodo = "hoje" | "semana" | "mes";

export const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "semana", rotulo: "Semana" },
  { id: "mes", rotulo: "Mês" },
];

export type Intervalo = { de: string; ate: string };

/** Período escolhido e o anterior do mesmo tamanho (ontem, semana passada, mês passado). */
export function intervalosDoPeriodo(
  periodo: Periodo,
  hoje: string,
): { atual: Intervalo; anterior: Intervalo; comparacao: string } {
  if (periodo === "hoje") {
    const ontem = addDaysISO(hoje, -1);
    return {
      atual: { de: hoje, ate: hoje },
      anterior: { de: ontem, ate: ontem },
      comparacao: "ontem",
    };
  }
  if (periodo === "semana") {
    const de = weekStart(hoje);
    return {
      atual: { de, ate: weekEnd(hoje) },
      anterior: { de: addDaysISO(de, -7), ate: addDaysISO(de, -1) },
      comparacao: "semana passada",
    };
  }
  const mes = hoje.slice(0, 7);
  const passado = shiftMonth(mes, -1);
  return {
    atual: { de: monthStart(mes), ate: monthEnd(mes) },
    anterior: { de: monthStart(passado), ate: monthEnd(passado) },
    comparacao: "mês passado",
  };
}

export function dentro(dia: string | null | undefined, i: Intervalo): boolean {
  return !!dia && dia >= i.de && dia <= i.ate;
}

/** Variação em % de um período para o outro; sem base (anterior zero), null. */
export function variacao(atual: number, anterior: number): number | null {
  if (!(anterior > 0)) return null;
  return ((atual - anterior) / anterior) * 100;
}

/** "+12%" / "−8%" / "0%" (sem base, "—"). */
export function textoVariacao(v: number | null): string {
  if (v === null) return "—";
  const r = Math.round(v);
  if (r === 0) return "0%";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}

export function ticketMedio(valor: number, quantidade: number): number {
  return quantidade > 0 ? Math.round((valor / quantidade) * 100) / 100 : 0;
}

/** Conversão em % (leads que viraram OS entre os que chamaram); sem leads, null. */
export function conversao(os: number, leads: number): number | null {
  return leads > 0 ? (os / leads) * 100 : null;
}

export type Semana = Intervalo & { rotulo: string };

/** As últimas `n` semanas (segunda a domingo), a atual por último. Rótulo: dia da segunda. */
export function semanasAte(hoje: string, n = 8): Semana[] {
  const inicioAtual = weekStart(hoje);
  const lista: Semana[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const de = addDaysISO(inicioAtual, -7 * i);
    lista.push({ de, ate: addDaysISO(de, 6), rotulo: `${de.slice(8, 10)}/${de.slice(5, 7)}` });
  }
  return lista;
}

export type Venda = { sale_date: string; valor: number; origem: string | null };

export function vendidoPorSemana(
  vendas: Venda[],
  semanas: Semana[],
): (Semana & { valor: number; quantidade: number })[] {
  return semanas.map((s) => {
    const do_periodo = vendas.filter((v) => dentro(v.sale_date, s));
    return {
      ...s,
      valor: round2(do_periodo.reduce((t, v) => t + v.valor, 0)),
      quantidade: do_periodo.length,
    };
  });
}

/** Vendas por origem, da maior para a menor; sem origem vira "Sem origem". */
export function vendidoPorOrigem(
  vendas: Venda[],
): { origem: string; valor: number; quantidade: number }[] {
  const mapa = new Map<string, { valor: number; quantidade: number }>();
  for (const v of vendas) {
    const chave = v.origem?.trim() || "Sem origem";
    const acc = mapa.get(chave) ?? { valor: 0, quantidade: 0 };
    acc.valor = round2(acc.valor + v.valor);
    acc.quantidade += 1;
    mapa.set(chave, acc);
  }
  return [...mapa.entries()]
    .map(([origem, a]) => ({ origem, ...a }))
    .sort((a, b) => b.valor - a.valor || a.origem.localeCompare(b.origem));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Quanto da meta o Vendido do mês (realizado + agendado + atrasado) já cobre. */
export function percentualDaMeta(vendidoMes: number, meta: number | null): number | null {
  if (!meta || !(meta > 0)) return null;
  return Math.max(0, (vendidoMes / meta) * 100);
}

// ------------------------------------------------------------------ atalhos

export type Atalho = {
  id: string;
  rotulo: string;
  to: string;
  icone: LucideIcon;
  search?: Record<string, string>;
  /** Só para estes papéis (fora da lista vale o `podeAcessar`). */
  papeis?: Papel[];
};

export const ATALHOS: Atalho[] = [
  {
    id: "financeiro",
    rotulo: "Financeiro",
    to: "/financeiro",
    icone: HandCoins,
    papeis: ["admin"],
  },
  { id: "os", rotulo: "OS", to: "/oss", icone: ClipboardList },
  { id: "agenda", rotulo: "Agenda", to: "/agenda", icone: CalendarDays },
  { id: "conversas", rotulo: "Conversas", to: "/conversas", icone: MessageCircle },
  { id: "marketing", rotulo: "Marketing", to: "/marketing", icone: Send },
  { id: "google", rotulo: "Google", to: "/google", icone: Globe },
  { id: "funil", rotulo: "Funil", to: "/crm/funil", icone: Filter },
  { id: "retornos", rotulo: "Retornos", to: "/crm/retornos", icone: Undo2 },
  { id: "operacao", rotulo: "Operação", to: "/operacao", icone: Coins, papeis: ["admin"] },
  { id: "notas", rotulo: "Notas", to: "/notas", icone: Receipt, papeis: ["admin"] },
  {
    id: "exportacoes",
    rotulo: "Exportações",
    to: "/exportacoes",
    icone: FileSpreadsheet,
    papeis: ["admin"],
  },
  {
    id: "configuracoes",
    rotulo: "Configurações",
    to: "/configuracoes",
    icone: Settings,
    papeis: ["admin"],
  },
  // Relatórios (DRE) entra pelo Financeiro; fica aqui para o ícone existir se um dia virar atalho.
  { id: "relatorios", rotulo: "Relatórios", to: "/dre", icone: BarChart3, papeis: [] },
];

/** Só os atalhos que a pessoa consegue abrir (papel e rotas liberadas). */
export function atalhosDoPapel(papel: Papel | null, souNexa = false): Atalho[] {
  return ATALHOS.filter(
    (a) =>
      (!a.papeis || (papel !== null && a.papeis.includes(papel)) || (souNexa && a.papeis.length)) &&
      podeAcessar(papel, a.to, souNexa),
  );
}

// ------------------------------------------------------------------ resposta do servidor

export type PartesVendido = {
  valor: number;
  cheio: number;
  realizado: number;
  agendado: number;
  atrasado: number;
  atrasadoQtd: number;
};

/** O que resumoPainel devolve: só totais (nunca linhas) e já cortado pelo papel no servidor. */
export type ResumoPainel = {
  periodo: Periodo;
  hoje: string;
  mes: string;
  atual: Intervalo;
  anterior: Intervalo;
  /** "ontem" | "semana passada" | "mês passado" */
  comparacao: string;
  /**
   * Vendido pela DATA DO SERVIÇO, líquido do repasse aos parceiros (itens terceirizados), aberto
   * em Realizado + Agendado + Atrasado. `cheio`: com a parte do parceiro (o que o cliente paga).
   */
  vendido: PartesVendido & {
    quantidade: number;
    anterior: { valor: number; quantidade: number };
  };
  /** O mesmo para o mês inteiro (meta e linha de atrasados), independente do período. */
  vendidoMes: PartesVendido;
  /** O que entrou no caixa no período (data do pagamento). */
  recebido: { valor: number; liquido: number; quantidade: number; anterior: { valor: number } };
  aReceber: { total: number; concluidos: number; agendados: number };
  /** Serviços concluídos sem nenhum recebimento (aviso do topo). */
  semRecebimento: { valor: number; quantidade: number };
  ticketMedio: { valor: number; anterior: number };
  conversao: {
    leads: number;
    orcamentos: number;
    os: number;
    pct: number | null;
    anterior: { leads: number; os: number; pct: number | null };
  };
  meta: { valor: number | null; pct: number | null };
  /** Só para admin (o servidor corta para os demais). */
  despesas: { pagas: number; aPagar: number } | null;
  /** Lucro líquido estimado do mês pelo DRE; só para admin. */
  lucro: number | null;
  vendidoPorSemana: (Semana & { valor: number; quantidade: number })[];
  vendidoPorOrigem: { origem: string; valor: number; quantidade: number }[];
  chips: { hoje: number; amanha: number; paraConcluir: number };
};
