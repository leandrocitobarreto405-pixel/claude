import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Etapas canônicas do funil (iguais para todas as empresas; ver public.etapa no banco). */
export const ETAPAS = [
  { id: "novo", label: "Novo", classe: "bg-secondary text-navy" },
  { id: "em_atendimento", label: "Em atendimento", classe: "bg-primary/10 text-primary" },
  { id: "orcamento", label: "Orçamento em montagem", classe: "bg-amber-100 text-amber-900" },
  { id: "orcamento_enviado", label: "Orçamento enviado", classe: "bg-amber-100 text-amber-900" },
  {
    id: "orcamento_aprovado",
    label: "Orçamento aprovado",
    classe: "bg-emerald-100 text-emerald-800",
  },
  { id: "os_criada", label: "OS criada", classe: "bg-emerald-100 text-emerald-800" },
  { id: "agendado", label: "Agendado", classe: "bg-emerald-100 text-emerald-800" },
  { id: "realizado", label: "Serviço realizado", classe: "bg-emerald-100 text-emerald-800" },
  { id: "faturado", label: "Faturado", classe: "bg-emerald-600 text-white" },
  { id: "perdido", label: "Perdido", classe: "bg-destructive/10 text-destructive" },
  { id: "encerrado", label: "Encerrado", classe: "bg-secondary text-muted-foreground" },
] as const;

export function etapaInfo(id: string | null | undefined) {
  return ETAPAS.find((e) => e.id === id) ?? ETAPAS[0];
}

/** Marcos do lead, em ordem. */
export const MARCOS = [
  { campo: "created_at", label: "Lead recebido" },
  { campo: "primeira_resposta_em", label: "Primeira resposta" },
  { campo: "orcamento_em", label: "Orçamento criado" },
  { campo: "orcamento_enviado_em", label: "Orçamento enviado" },
  { campo: "orcamento_aprovado_em", label: "Orçamento aprovado" },
  { campo: "os_criada_em", label: "OS criada" },
  { campo: "agendado_em", label: "Serviço agendado" },
  { campo: "realizado_em", label: "Serviço realizado" },
  { campo: "faturado_em", label: "Pagamento recebido" },
] as const;

/** Leads novos (o cliente chamou) ou reativação (a empresa chamou). */
export type Entrada = "receptivo" | "ativo";

export type Indicadores = {
  periodo: { de: string; ate: string };
  entrada: Entrada | "todos";
  /** Quantos leads de cada tipo tiveram o primeiro contato no período. */
  entradas: Record<Entrada, number>;
  funil: {
    leads: number;
    /** Leads que mandaram pelo menos uma mensagem (na reativação: responderam ao contato). */
    responderam: number;
    atendidos: number;
    orcamento: number;
    orcamento_enviado: number;
    orcamento_aprovado: number;
    os_criada: number;
    agendado: number;
    realizado: number;
    faturado: number;
    perdidos: number;
    abertos: number;
  };
  etapas: Record<string, number>;
  atendimento: {
    conversas: number;
    respondidos: number;
    sem_resposta: number;
    primeira_resposta_mediana_min: number | null;
    primeira_resposta_p90_min: number | null;
  };
  valores: { orcado: number; vendido: number; recebido: number };
  periodo_geral: {
    orcamentos: number;
    orcamentos_enviados: number;
    orcamentos_aprovados: number;
    orcamentos_recusados: number;
    valor_aprovado: number;
    lucro_medio_aprovado_pct: number | null;
    os: number;
    vendido: number;
    ticket_medio: number | null;
    recebido: number;
    recebido_liquido: number;
  };
  origens: { origem: string; leads: number; orcamentos: number; vendas: number; vendido: number }[];
};

export function useIndicadores(
  de: string,
  ate: string,
  empresaId: string | null | undefined,
  entrada: Entrada = "receptivo",
) {
  return useQuery({
    queryKey: ["indicadores_funil", empresaId, de, ate, entrada],
    enabled: Boolean(de && ate),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("indicadores_funil", {
        _de: de,
        _ate: ate,
        _entrada: entrada,
      });
      if (error) throw error;
      return data as unknown as Indicadores;
    },
  });
}

/** "12 min", "2 h 5 min", "3 d". */
export function duracaoMin(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(min / 60 / 24)} d`;
}

/** Conversão entre duas contagens, em %, sem dividir por zero. */
export function taxa(parte: number, total: number): number | null {
  return total > 0 ? (parte / total) * 100 : null;
}
