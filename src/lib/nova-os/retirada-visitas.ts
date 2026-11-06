import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { feriadoBloqueia } from "@/lib/feriados";
import { useTabelaPrecos } from "@/lib/precos";
import {
  HORA_RETIRADA,
  entregaPrevista,
  retiradaDoAtendimento,
  separarPorTipo,
  tipoDaLinha,
  type TipoRetirada,
} from "@/lib/retirada";

/**
 * Retirada de persiana/tapete nos formulários de OS (05/11): qual atendimento é retirada, a entrega
 * prevista pelo cálculo e a separação de um atendimento misturado. Serve à janela e à página.
 */
export type ItemCatalogo = { nome: string; categoria: string | null; parceiro_id: string | null };

type ItemDaVisita = { description: string; upholstery_type_id?: string | null };
type VisitaBase<I extends ItemDaVisita> = {
  scheduled_date: string;
  technician_id: string;
  entrega_prevista?: string;
  entrega_editada?: boolean;
  items: I[];
};

export type InfoRetirada =
  | { situacao: "comum" }
  | { situacao: "misturado"; tipos: TipoRetirada[] }
  | {
      situacao: "retirada";
      tipo: TipoRetirada;
      /** Entrega pelo cálculo (dias úteis, feriados que bloqueiam não contam). */
      entregaCalculada: string;
      /** Entrega que vale: a editada pela equipe ou a calculada. */
      entrega: string;
      /** Parceiro do item na tabela de preços (Diego na persiana, Reginaldo no tapete). */
      parceiroId: string | null;
    };

export function descricaoDoItem(
  it: ItemDaVisita,
  estofados: Array<{ id: string; name: string }>,
): string {
  return it.description.trim() || estofados.find((s) => s.id === it.upholstery_type_id)?.name || "";
}

function parceiroDoTipo(
  itens: ItemDaVisita[],
  tipo: TipoRetirada,
  catalogo: ItemCatalogo[],
  estofados: Array<{ id: string; name: string }>,
): string | null {
  for (const it of itens) {
    const d = descricaoDoItem(it, estofados);
    if (tipoDaLinha(d, catalogo) !== tipo) continue;
    const item = catalogo.find((c) => d === c.nome || d.startsWith(`${c.nome} —`));
    if (item?.parceiro_id) return item.parceiro_id;
  }
  return catalogo.find((c) => c.categoria === tipo && c.parceiro_id)?.parceiro_id ?? null;
}

export function infoRetirada<I extends ItemDaVisita>(
  v: VisitaBase<I>,
  catalogo: ItemCatalogo[],
  estofados: Array<{ id: string; name: string }>,
  bloqueados: ReadonlySet<string>,
): InfoRetirada {
  const r = retiradaDoAtendimento(
    v.items.map((it) => descricaoDoItem(it, estofados)),
    catalogo,
  );
  if (r.situacao !== "retirada") return r;
  const entregaCalculada = v.scheduled_date
    ? entregaPrevista(v.scheduled_date, r.tipo, bloqueados)
    : "";
  return {
    situacao: "retirada",
    tipo: r.tipo,
    entregaCalculada,
    entrega: v.entrega_editada && v.entrega_prevista ? v.entrega_prevista : entregaCalculada,
    parceiroId: parceiroDoTipo(v.items, r.tipo, catalogo, estofados),
  };
}

/**
 * Separa as linhas de persiana/tapete de um atendimento misturado: o atendimento fica com os
 * outros itens e ganha, logo depois dele, um atendimento de retirada por tipo, com o parceiro.
 */
export function separarRetirada<I extends ItemDaVisita, V extends VisitaBase<I>>(
  visitas: V[],
  i: number,
  catalogo: ItemCatalogo[],
  estofados: Array<{ id: string; name: string }>,
  nova: (tecnicoId: string, data: string) => V,
): V[] {
  const v = visitas[i];
  if (!v) return visitas;
  const { comum, porTipo } = separarPorTipo(
    v.items,
    (it) => descricaoDoItem(it, estofados),
    catalogo,
  );
  const tipos = (Object.keys(porTipo) as TipoRetirada[]).filter((t) => porTipo[t]?.length);
  if (!tipos.length || !comum.length) return visitas;
  const novas = tipos.map((tipo) => {
    const base = nova(parceiroDoTipo(v.items, tipo, catalogo, estofados) ?? "", v.scheduled_date);
    return {
      ...base,
      service_type_id: (v as { service_type_id?: string }).service_type_id ?? "",
      scheduled_time: HORA_RETIRADA,
      ocupa_dia: "nao",
      items: porTipo[tipo]!,
    } as V;
  });
  return [...visitas.slice(0, i), { ...v, items: comum }, ...novas, ...visitas.slice(i + 1)];
}

/** Catálogo (tabela de preços) e feriados que bloqueiam o dia, para o cálculo da entrega. */
export function useDadosRetirada() {
  const { data: tabela } = useTabelaPrecos();
  const { data: feriados } = useQuery({
    queryKey: ["feriados-retirada"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("feriados" as never)
        .select("data, trabalhamos")
        .gte("data", hoje)
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Array<{ data: string; trabalhamos: boolean | null }>;
    },
  });
  const catalogo = useMemo<ItemCatalogo[]>(
    () =>
      (tabela ?? []).map((c) => ({
        nome: c.nome,
        categoria: c.categoria,
        parceiro_id: c.parceiro_id,
      })),
    [tabela],
  );
  const bloqueados = useMemo(
    () => new Set((feriados ?? []).filter((f) => feriadoBloqueia(f)).map((f) => f.data)),
    [feriados],
  );
  return { catalogo, bloqueados };
}
