/**
 * Alarme de crédito da IA no Painel Nexa: paradas abertas (aviso vermelho e sininho) e o histórico do
 * mês por empresa (Consumo). Só a Nexa.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireNexaAdmin } from "@/lib/nexa.middleware";

export type ParadaIa = {
  id: string;
  empresa: string;
  empresa_id: string;
  provedor: "ia" | "voz";
  causa: "credito" | "autenticacao";
  inicio: string;
  fim: string | null;
  erros: number;
  conversas: number;
};

type Linha = {
  id: string;
  empresa_id: string;
  provedor: string;
  causa: string;
  inicio: string;
  fim: string | null;
  erros: number;
  conversas: string[] | null;
  empresa: { nome: string } | null;
};

function lerParada(l: Linha): ParadaIa {
  return {
    id: l.id,
    empresa: l.empresa?.nome ?? "Empresa",
    empresa_id: l.empresa_id,
    provedor: l.provedor === "voz" ? "voz" : "ia",
    causa: l.causa === "autenticacao" ? "autenticacao" : "credito",
    inicio: l.inicio,
    fim: l.fim,
    erros: l.erros,
    conversas: l.conversas?.length ?? 0,
  };
}

const COLUNAS =
  "id, empresa_id, provedor, causa, inicio, fim, erros, conversas, empresa:empresa_id ( nome )";

/** Paradas abertas agora (todas as empresas). */
export const paradasAbertasFn = createServerFn({ method: "GET" })
  .middleware([requireNexaAdmin])
  .handler(async ({ context }): Promise<ParadaIa[]> => {
    const { data } = await context.supabase
      .from("ia_paradas")
      .select(COLUNAS)
      .is("fim", null)
      .order("inicio");
    return ((data ?? []) as unknown as Linha[]).map(lerParada);
  });

/** Paradas que começaram no mês (YYYY-MM-01) ou ainda abertas. */
export const paradasDoMesFn = createServerFn({ method: "GET" })
  .middleware([requireNexaAdmin])
  .inputValidator((i: { mes: string }) => {
    if (!/^\d{4}-\d{2}-01$/.test(String(i?.mes))) throw new Error("Mês inválido.");
    return { mes: String(i.mes) };
  })
  .handler(async ({ data, context }): Promise<ParadaIa[]> => {
    const [a, m] = data.mes.split("-").map(Number) as [number, number];
    const inicio = new Date(Date.UTC(a, m - 1, 1, 3)).toISOString();
    const fim = new Date(Date.UTC(a, m, 1, 3)).toISOString();
    const { data: linhas } = await context.supabase
      .from("ia_paradas")
      .select(COLUNAS)
      .lt("inicio", fim)
      .or(`fim.is.null,fim.gte.${inicio}`)
      .order("inicio", { ascending: false })
      .limit(200);
    return ((linhas ?? []) as unknown as Linha[]).map(lerParada);
  });
