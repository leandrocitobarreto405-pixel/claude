// Planos do Nexa OS e assinatura de cada empresa (Fase B, decisões A e B). Catálogo global: as
// empresas só leem; quem altera é o admin da Nexa (Painel Nexa › Planos).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import { RECURSOS } from "@/lib/recursos";

/** Recursos que a Nexa liga em cada plano (o resto é do Essencial, em todos). */
export const RECURSOS_PLANO = RECURSOS.map((r) => ({
  chave: r.chave,
  rotulo: r.rotulo,
  telas: r.telas,
}));

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
  /** Admin e atendente (técnicos não contam); null = sem limite. */
  limite_usuarios: number | null;
  /** Aparece na tabela pública de preços (Nexa Gestão e Interna não). */
  publico: boolean;
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
  /** Isenta de cobrança: nunca gera fatura nem fica inadimplente (ex.: Turbine). */
  isenta?: boolean;
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
  limite_usuarios?: number | null;
  publico?: boolean | null;
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
    limite_usuarios:
      l.limite_usuarios === null || l.limite_usuarios === undefined
        ? null
        : Number(l.limite_usuarios),
    publico: l.publico !== false,
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

/** Dias antes do fim do grátis em que o Painel Nexa começa a avisar. */
export const DIAS_AVISO_FIM_GRATIS = 15;

/**
 * Avisos do Painel Nexa: empresa com período grátis acabando (a partir de 15 dias antes) ou já
 * acabado e ainda sem mensalidade (vazia ou R$ 0). "Ecoprime: período grátis termina em 02/01 —
 * defina a mensalidade". Sem mensalidade a empresa nunca fica em atraso (o banco garante); o aviso
 * é para a Nexa definir o valor a tempo.
 */
export function avisosFimGratis(
  empresas: { nome: string; assinatura: Assinatura | null }[],
  planos: Pick<Plano, "id" | "preco_mensal">[],
  hoje: string,
  dias = DIAS_AVISO_FIM_GRATIS,
): string[] {
  const avisos: string[] = [];
  for (const e of empresas) {
    const a = e.assinatura;
    if (!a?.gratis_ate || a.status === "cancelada" || a.isenta) continue;
    const valor = mensalidade(
      a,
      planos.find((p) => p.id === a.plano_id),
    );
    const definida = valor !== null && valor > 0;
    const faltam = (Date.parse(a.gratis_ate) - Date.parse(hoje)) / 86_400_000;
    if (faltam > dias) continue;
    // Com mensalidade definida, avisa só até o fim do grátis (depois a cobrança já começou).
    if (definida && faltam < 0) continue;
    const [, mes, dia] = a.gratis_ate.split("-");
    const verbo = faltam < 0 ? "terminou" : "termina";
    const depois = definida
      ? `passa a pagar ${brl(valor)}${a.proximo_vencimento ? ` em ${dateBR(a.proximo_vencimento)}` : ""}`
      : "defina a mensalidade";
    avisos.push(`${e.nome}: período grátis ${verbo} em ${dia}/${mes} — ${depois}`);
  }
  return avisos;
}

/** Receita mensal recorrente: mensalidade das assinaturas ativas ou inadimplentes (com valor). */
export function mrr(
  assinaturas: (Assinatura | null)[],
  planos: Pick<Plano, "id" | "preco_mensal">[],
): number {
  let total = 0;
  for (const a of assinaturas) {
    if (!a || a.isenta || (a.status !== "ativa" && a.status !== "inadimplente")) continue;
    const valor = mensalidade(
      a,
      planos.find((p) => p.id === a.plano_id),
    );
    if (valor !== null && valor > 0) total += valor;
  }
  return Math.round(total * 100) / 100;
}

/** Situação do portão (private.empresa_situacao). */
export type SituacaoPortao = "ok" | "aviso" | "somente_leitura" | "bloqueada";

/**
 * Etiqueta da lista do Painel Nexa: Isenta / Em teste até dd/mm / Ativa / Carência /
 * Somente consulta / Bloqueada.
 */
export function situacaoCobranca(
  a: Pick<Assinatura, "status" | "gratis_ate" | "isenta"> | null,
  situacao: SituacaoPortao | null | undefined,
  hoje: string,
): { rotulo: string; tom: "sucesso" | "neutro" | "atencao" | "problema" } {
  if (situacao === "bloqueada" || a?.status === "cancelada")
    return { rotulo: "Bloqueada", tom: "problema" };
  if (a?.isenta) return { rotulo: "Isenta", tom: "neutro" };
  if (situacao === "somente_leitura") return { rotulo: "Somente consulta", tom: "problema" };
  if (situacao === "aviso") return { rotulo: "Carência", tom: "atencao" };
  if (a?.status === "trial" && a.gratis_ate && a.gratis_ate >= hoje)
    return { rotulo: `Em teste até ${dateBR(a.gratis_ate)}`, tom: "atencao" };
  return { rotulo: "Ativa", tom: "sucesso" };
}

/** Atalhos de "Em teste até": hoje + 30 dias e hoje + 3 meses (último dia do teste). */
export function fimDoTeste(hoje: string, atalho: "30d" | "3m"): string {
  if (atalho === "3m") return periodoGratis(hoje, 3).gratisAte;
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}
