// Regras da lista "OS e orçamentos" em cartões (sem acesso a banco, para poder testar).
import type { TomChip } from "@/components/nexa";

export type VisitaDaLista = {
  status: string;
  scheduled_date: string;
  scheduled_time: string | null;
  technician_id: string | null;
  technician?: { name: string } | null;
  upholstery_description: string | null;
  service_type: { name: string } | null;
  service_items: Array<{ description: string | null; active: boolean }>;
};

export type OsDaLista = {
  id: string;
  os_number: string;
  sale_date: string;
  status: string;
  total_gross_value: number;
  eh_teste?: boolean | null;
  cancelled_at: string | null;
  deleted_at: string | null;
  salesperson_id: string | null;
  vendido_por?: string | null;
  vendedora?: { atendente_nexa: boolean | null } | null;
  customer: { full_name: string; phone: string | null } | null;
  visits: VisitaDaLista[];
  work_order_documents: Array<{ is_active: boolean; generation_status: string }>;
};

export type ChipOs = "todas" | "agendadas" | "andamento" | "concluidas" | "sem-doc" | "canceladas";

export const CHIPS_OS: { id: ChipOs; rotulo: string }[] = [
  { id: "todas", rotulo: "Todas" },
  { id: "agendadas", rotulo: "Agendadas" },
  { id: "andamento", rotulo: "Em andamento" },
  { id: "concluidas", rotulo: "Concluídas" },
  { id: "sem-doc", rotulo: "Sem documento" },
  { id: "canceladas", rotulo: "Canceladas" },
];

/** Agendadas e Em andamento mostram tudo o que está em aberto, sem limite de período. */
export function chipSemPeriodo(chip: ChipOs): boolean {
  return chip === "agendadas" || chip === "andamento";
}

/** Situações da OS que ainda estão em aberto (para a busca sem período). */
export const STATUS_OS_ABERTAS = ["Agendada", "Reagendada", "Parcialmente concluída"];

const VISITA_EM_ANDAMENTO = ["Em deslocamento", "Em execução"];

export function cancelada(r: OsDaLista): boolean {
  return Boolean(r.cancelled_at) || r.status === "Cancelada";
}

export function temDocumento(r: OsDaLista): boolean {
  return r.work_order_documents.some((d) => d.is_active && d.generation_status === "Gerado");
}

export function emAndamento(r: OsDaLista): boolean {
  if (cancelada(r) || r.deleted_at) return false;
  return (
    r.status === "Parcialmente concluída" ||
    r.visits.some((v) => VISITA_EM_ANDAMENTO.includes(v.status))
  );
}

/** Etiqueta do cartão. */
export function situacaoDaOs(r: OsDaLista): { rotulo: string; tom: TomChip } {
  if (r.deleted_at) return { rotulo: "Excluída", tom: "problema" };
  if (cancelada(r)) return { rotulo: "Cancelada", tom: "problema" };
  if (r.status === "Concluída") return { rotulo: "Concluída", tom: "sucesso" };
  if (emAndamento(r)) return { rotulo: "Em andamento", tom: "atencao" };
  if (r.status === "Reagendada") return { rotulo: "Reagendada", tom: "atencao" };
  return { rotulo: "Agendada", tom: "neutro" };
}

export function filtrarPorChip(lista: OsDaLista[], chip: ChipOs): OsDaLista[] {
  switch (chip) {
    case "todas":
      return lista.filter((r) => !r.deleted_at);
    case "agendadas":
      return lista.filter(
        (r) => !r.deleted_at && !cancelada(r) && !emAndamento(r) && r.status !== "Concluída",
      );
    case "andamento":
      return lista.filter(emAndamento);
    case "concluidas":
      return lista.filter((r) => !r.deleted_at && !cancelada(r) && r.status === "Concluída");
    case "sem-doc":
      return lista.filter((r) => !r.deleted_at && !cancelada(r) && !temDocumento(r));
    case "canceladas":
      return lista.filter((r) => !r.deleted_at && cancelada(r));
  }
}

/** Busca por nº da OS, cliente, telefone (só dígitos) e estofado. */
export function buscarOs(lista: OsDaLista[], busca: string): OsDaLista[] {
  const termo = busca.trim().toLowerCase();
  if (!termo) return lista;
  const digitos = termo.replace(/\D/g, "");
  return lista.filter((r) => {
    const estofados = r.visits
      .flatMap((v) => [
        v.upholstery_description ?? "",
        ...v.service_items.filter((i) => i.active !== false).map((i) => i.description ?? ""),
      ])
      .join(" ");
    const alvo = `${r.os_number} ${r.customer?.full_name ?? ""} ${estofados}`.toLowerCase();
    const telefone = (r.customer?.phone ?? "").replace(/\D/g, "");
    return alvo.includes(termo) || (digitos.length >= 4 && telefone.includes(digitos));
  });
}

/** Total do que está na tela: sem OS de teste, canceladas ou excluídas. */
export function totalDaLista(lista: OsDaLista[]): { quantidade: number; valor: number } {
  const validas = lista.filter((r) => !r.eh_teste && !cancelada(r) && !r.deleted_at);
  return {
    quantidade: validas.length,
    valor:
      Math.round(validas.reduce((s, r) => s + Number(r.total_gross_value ?? 0), 0) * 100) / 100,
  };
}

/** "14 OS em outubro · R$ 4.465" (sem centavos). */
export function textoTotal(t: { quantidade: number; valor: number }, periodo: string): string {
  const reais = t.valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
  return `${t.quantidade} OS ${periodo} · ${reais.replace(/\u00a0/g, " ")}`;
}

/** Próximo atendimento (hoje ou depois, não cancelado); sem nenhum, o último. */
export function atendimentoDoCartao(visitas: VisitaDaLista[], hoje: string): VisitaDaLista | null {
  const ativas = visitas
    .filter((v) => v.status !== "Cancelado")
    .sort((a, b) =>
      (a.scheduled_date + (a.scheduled_time ?? "")).localeCompare(
        b.scheduled_date + (b.scheduled_time ?? ""),
      ),
    );
  if (!ativas.length) return null;
  return ativas.find((v) => v.scheduled_date >= hoje) ?? ativas[ativas.length - 1]!;
}

/** "Higienização · Sofá 3 lugares" (serviços distintos + primeiro estofado). */
export function resumoDoServico(r: OsDaLista): string {
  const servicos = [...new Set(r.visits.map((v) => v.service_type?.name).filter(Boolean))];
  const estofado =
    r.visits.map((v) => v.upholstery_description).find(Boolean) ??
    r.visits
      .flatMap((v) => v.service_items.filter((i) => i.active !== false).map((i) => i.description))
      .find(Boolean) ??
    null;
  return [servicos.join(" + ") || null, estofado].filter(Boolean).join(" · ") || "—";
}
