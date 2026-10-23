// Planos do Nexa OS e assinatura de cada empresa (Fase B, decisões A e B). Catálogo global: as
// empresas só leem; quem altera é o admin da Nexa (Painel Nexa › Planos).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";

export const RECURSOS_PLANO = [
  { chave: "caixa_entrada", rotulo: "Caixa de entrada (WhatsApp)" },
  { chave: "alice", rotulo: "Alice" },
  { chave: "marketing", rotulo: "Marketing" },
] as const;

export type Plano = {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  /** null = mensalidade ainda não definida. */
  preco_mensal: number | null;
  comissao_pct: number;
  recursos: Record<string, boolean>;
  ativo: boolean;
  ordem: number;
};

export type StatusAssinatura = "trial" | "ativa" | "inadimplente" | "cancelada";

export const STATUS_ASSINATURA: Record<StatusAssinatura, string> = {
  trial: "Grátis (teste)",
  ativa: "Ativa",
  inadimplente: "Inadimplente",
  cancelada: "Cancelada",
};

export type Assinatura = {
  id: string;
  empresa_id: string;
  plano_id: string;
  valor_mensal: number | null;
  status: StatusAssinatura;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  gratis_ate: string | null;
  proximo_vencimento: string | null;
  contrato_pdf_path: string | null;
  contrato_pdf_em: string | null;
};

type LinhaPlano = {
  id: string;
  codigo: string;
  nome: string;
  descricao?: string | null;
  preco_mensal?: number | string | null;
  comissao_pct?: number | string | null;
  recursos?: unknown;
  ativo?: boolean | null;
  ordem?: number | null;
};

export function lerPlano(l: LinhaPlano): Plano {
  const recursos =
    l.recursos && typeof l.recursos === "object" ? (l.recursos as Record<string, unknown>) : {};
  return {
    id: l.id,
    codigo: l.codigo,
    nome: l.nome,
    descricao: l.descricao ?? null,
    preco_mensal:
      l.preco_mensal === null || l.preco_mensal === undefined ? null : Number(l.preco_mensal),
    comissao_pct: Number(l.comissao_pct ?? 0),
    recursos: Object.fromEntries(Object.entries(recursos).map(([k, v]) => [k, v === true])),
    ativo: l.ativo !== false,
    ordem: Number(l.ordem ?? 0),
  };
}

export const CHAVE_PLANOS = ["planos"] as const;

export function usePlanos(habilitado = true) {
  return useQuery({
    queryKey: CHAVE_PLANOS,
    enabled: habilitado,
    queryFn: async (): Promise<Plano[]> => {
      const { data, error } = await supabase.from("planos").select("*").order("ordem");
      if (error) throw error;
      return (data ?? []).map((l) => lerPlano(l));
    },
  });
}

/** Mensalidade que vale: a da assinatura; sem ela, a do plano (null = a definir). */
export function mensalidade(
  assinatura: Pick<Assinatura, "valor_mensal">,
  plano: Pick<Plano, "preco_mensal"> | undefined,
): number | null {
  if (assinatura.valor_mensal !== null) return Number(assinatura.valor_mensal);
  return plano?.preco_mensal ?? null;
}

/**
 * Cliente da consultoria: N meses grátis a partir do início do contrato. Devolve o último dia
 * grátis e o primeiro vencimento ("2026-10-03", 3 → até 2027-01-02, vence 2027-01-03). Dia que não
 * existe no mês de destino cai no último dia dele.
 */
export function periodoGratis(inicio: string, meses: number) {
  const [a, m, d] = inicio.split("-").map(Number) as [number, number, number];
  const alvoMes = m - 1 + meses;
  const ano = a + Math.floor(alvoMes / 12);
  const mes = alvoMes % 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const vence = new Date(Date.UTC(ano, mes, Math.min(d, ultimoDia)));
  const ate = new Date(vence.getTime() - 86_400_000);
  return {
    gratisAte: ate.toISOString().slice(0, 10),
    vencimento: vence.toISOString().slice(0, 10),
  };
}

/** "Nexa Gestão · mensalidade a definir · Grátis (teste) · grátis até 02/01/2027". */
export function resumoAssinatura(a: Assinatura | null, planos: Plano[]): string {
  if (!a) return "sem assinatura";
  const plano = planos.find((p) => p.id === a.plano_id);
  const valor = mensalidade(a, plano);
  const partes = [
    plano?.nome ?? "plano",
    valor === null ? "mensalidade a definir" : `${brl(valor)}/mês`,
    STATUS_ASSINATURA[a.status],
  ];
  if (a.gratis_ate) partes.push(`grátis até ${dateBR(a.gratis_ate)}`);
  return partes.join(" · ");
}
