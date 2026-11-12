// Regras da tela Agenda (sem acesso a banco, para poder testar).
import type { TomChip } from "@/components/nexa";
import type { BudgetVisitRow } from "@/lib/budget-visits";
import { addDaysISO, dateBR } from "@/lib/format";
import type { VisitRow } from "@/lib/os";
import { HORA_RETIRADA, diaCurto, textoDoBloco } from "@/lib/retirada";

/** Atendimento da agenda já no formato da tela (serviço de uma OS ou visita de orçamento). */
export type Atendimento = {
  id: string;
  tipo: "os" | "orcamento";
  data: string;
  hora: string;
  status: string;
  cliente: string;
  /** Tipo de serviço (ou "Visita de orçamento"). */
  servico: string;
  /** O que vai ser limpo (ex.: "Sofá 3 lugares"). */
  peca: string | null;
  bairro: string | null;
  endereco: string | null;
  telefone: string | null;
  tecnico: string | null;
  valor: number | null;
  /** Observação curta (entrega, OS gerada...). */
  nota: string | null;
  /** Linha discreta do cartão aberto: "remarcado de seg 09/11". */
  historico?: string | null;
  /** Persiana/tapete (05/11): etapa da retirada no galpão, em horário comercial. */
  etapa?: "Retirada" | "Entrega";
};

const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Os 7 dias (segunda a domingo) da semana que contém `ref`. */
export function semanaDe(ref: string): { iso: string; curto: string; dia: number }[] {
  const d = new Date(`${ref}T12:00:00`);
  const segunda = addDaysISO(ref, -((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysISO(segunda, i);
    const data = new Date(`${iso}T12:00:00`);
    return { iso, curto: DIAS_CURTOS[data.getDay()] ?? "", dia: data.getDate() };
  });
}

/**
 * Status que já saíram da rota do dia (não contam como "próximo serviço"). A visita remarcada
 * ("Reagendado", registros antigos) é um agendamento normal no dia novo: NÃO é encerrada (12/11).
 */
const ENCERRADOS = ["Concluído", "Cancelado", "Reagendado com deslocamento", "Entregue"];

/** A visita antiga de um reagendamento com deslocamento: só histórico, não aparece na agenda. */
export const VISITA_ANTIGA_DO_REAGENDAMENTO = "Reagendado com deslocamento";

/**
 * Status para mostrar (12/11): visita remarcada aparece como "Agendado", igual às outras. O
 * histórico ("remarcado de seg 09/11") fica só dentro do cartão aberto e na OS.
 */
export function statusParaMostrar(status: string | null | undefined): string {
  return status === "Reagendado" ? "Agendado" : status || "Agendado";
}

const SEMANA_CURTA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "remarcado de seg 09/11", quando a visita veio de outra data; senão null. */
export function historicoDaRemarcacao(v: {
  status?: string | null;
  scheduled_date: string;
  original_scheduled_date?: string | null;
}): string | null {
  const de = v.original_scheduled_date;
  if (!de || de === v.scheduled_date || v.status === VISITA_ANTIGA_DO_REAGENDAMENTO) return null;
  const dia = SEMANA_CURTA[new Date(`${de.slice(0, 10)}T12:00:00Z`).getUTCDay()] ?? "";
  return `remarcado de ${dia} ${de.slice(8, 10)}/${de.slice(5, 7)}`;
}

export function encerrado(status: string): boolean {
  return ENCERRADOS.includes(status);
}

/** Etiqueta curta e tom do chip para cada status de atendimento. */
export function chipDoStatus(status: string): { rotulo: string; tom: TomChip } {
  switch (status) {
    case "Concluído":
      return { rotulo: "Feito", tom: "sucesso" };
    case "Entregue":
      return { rotulo: "Entregue", tom: "sucesso" };
    case "Em deslocamento":
      return { rotulo: "A caminho", tom: "atencao" };
    case "Em execução":
      return { rotulo: "Em execução", tom: "atencao" };
    case "Confirmado":
      return { rotulo: "Confirmado", tom: "sucesso" };
    case "Reagendado":
      return { rotulo: "Agendado", tom: "neutro" };
    case "Reagendado com deslocamento":
      return { rotulo: "Reagendado", tom: "atencao" };
    case "Cancelado":
      return { rotulo: "Cancelado", tom: "problema" };
    default:
      return { rotulo: status || "Agendado", tom: "neutro" };
  }
}

/**
 * Qual atendimento já abre expandido: no dia de hoje, o primeiro (por horário) que ainda não
 * foi encerrado. Em outros dias, nenhum.
 */
export function idAtual<T extends { id: string; status: string; time: string }>(
  itens: T[],
  dia: string,
  hoje: string,
): string | null {
  if (dia !== hoje) return null;
  const ordem = [...itens].sort((a, b) => a.time.localeCompare(b.time));
  return ordem.find((i) => !encerrado(i.status))?.id ?? null;
}

/** Quantos atendimentos (não cancelados) há em cada dia. */
export function contagemPorDia(itens: { date: string; status: string }[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const i of itens) {
    if (i.status === "Cancelado" || i.status === VISITA_ANTIGA_DO_REAGENDAMENTO) continue;
    mapa.set(i.date, (mapa.get(i.date) ?? 0) + 1);
  }
  return mapa;
}

/** "Outubro 2026" (ou "Set – Out 2026" quando a semana cruza o mês). */
export function rotuloDoMes(dias: { iso: string }[]): string {
  const nomes = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  const primeiro = dias[0]?.iso ?? "";
  const ultimo = dias[dias.length - 1]?.iso ?? primeiro;
  const [a1, m1] = primeiro.split("-").map(Number);
  const [a2, m2] = ultimo.split("-").map(Number);
  if (a1 === a2 && m1 === m2) return `${nomes[(m1 ?? 1) - 1]} ${a1}`;
  const curto = (m: number | undefined) => (nomes[(m ?? 1) - 1] ?? "").slice(0, 3);
  return a1 === a2
    ? `${curto(m1)} – ${curto(m2)} ${a2}`
    : `${curto(m1)} ${a1} – ${curto(m2)} ${a2}`;
}

/** "Entrega prevista: sex 13/11" (sem a data, nada). */
function notaDaEntrega(v: VisitRow): string | null {
  if (!v.entrega_prevista) return null;
  return v.entrega_feita_em
    ? `Entregue em ${dateBR(v.entrega_feita_em.slice(0, 10))}`
    : `Entrega prevista: ${diaCurto(v.entrega_prevista)}`;
}

/** Bloco da Entrega de uma retirada (persiana/tapete), no dia da entrega prevista. */
export function deEntrega(v: VisitRow): Atendimento {
  const cli = v.work_order?.customer;
  return {
    id: `ent-${v.id}`,
    tipo: "os",
    data: v.entrega_prevista ?? v.scheduled_date,
    hora: HORA_RETIRADA,
    status: v.entrega_feita_em ? "Entregue" : "Agendado",
    cliente: cli?.full_name ?? "Cliente",
    servico: textoDoBloco(
      "Entrega",
      v.work_order?.os_number ? `OS ${v.work_order.os_number}` : "",
      null,
    ),
    peca: v.upholstery_description || v.upholstery_type?.name || null,
    bairro: cli?.neighborhood ?? null,
    endereco: cli?.full_address ?? null,
    telefone: cli?.phone ?? null,
    tecnico: v.technician?.name ?? null,
    // O valor fica na retirada: a entrega não soma de novo no dia.
    valor: null,
    nota: `Retirada em ${diaCurto(v.scheduled_date)}`,
    etapa: "Entrega",
  };
}

export function deVisita(v: VisitRow): Atendimento {
  const cli = v.work_order?.customer;
  const nota =
    v.status === "Reagendado com deslocamento"
      ? `Deslocamento feito · serviço reagendado${v.rescheduled_to_visit_id ? " (novo atendimento criado)" : ""}`
      : v.retirada
        ? notaDaEntrega(v)
        : null;
  return {
    id: `os-${v.id}`,
    tipo: "os",
    data: v.scheduled_date,
    hora: v.scheduled_time,
    status: v.status,
    cliente: cli?.full_name ?? "Cliente",
    servico: [
      v.retirada ? "Retirada" : (v.service_type?.name ?? "Serviço"),
      v.work_order?.os_number ? `OS ${v.work_order.os_number}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    peca: v.upholstery_description || v.upholstery_type?.name || null,
    bairro: cli?.neighborhood ?? null,
    endereco: cli?.full_address ?? null,
    telefone: cli?.phone ?? null,
    tecnico: v.technician?.name ?? null,
    valor: Number(v.final_value ?? v.visit_value ?? 0) || null,
    nota,
    historico: historicoDaRemarcacao(v),
    ...(v.retirada ? { etapa: "Retirada" as const } : {}),
  };
}

export function deOrcamento(b: BudgetVisitRow): Atendimento {
  const cli = b.customer;
  return {
    id: `orc-${b.id}`,
    tipo: "orcamento",
    data: b.scheduled_date,
    hora: b.scheduled_time,
    status: b.status,
    cliente: cli?.full_name ?? "Cliente",
    servico: "Visita de orçamento",
    peca: b.upholstery_description || null,
    bairro: cli?.neighborhood ?? null,
    endereco: cli?.full_address ?? null,
    telefone: cli?.phone ?? null,
    tecnico: b.technician?.name ?? null,
    valor: Number(b.visit_fee ?? 0) || null,
    nota: b.generated_work_order ? `OS gerada: ${b.generated_work_order.os_number}` : null,
  };
}
