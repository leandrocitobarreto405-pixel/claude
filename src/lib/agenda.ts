// Regras da tela Agenda (sem acesso a banco, para poder testar).
import type { TomChip } from "@/components/nexa";
import { addDaysISO } from "@/lib/format";

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

/** Status que já saíram da rota do dia (não contam como "próximo serviço"). */
const ENCERRADOS = ["Concluído", "Cancelado", "Reagendado", "Reagendado com deslocamento"];

export function encerrado(status: string): boolean {
  return ENCERRADOS.includes(status);
}

/** Etiqueta curta e tom do chip para cada status de atendimento. */
export function chipDoStatus(status: string): { rotulo: string; tom: TomChip } {
  switch (status) {
    case "Concluído":
      return { rotulo: "Feito", tom: "sucesso" };
    case "Em deslocamento":
      return { rotulo: "A caminho", tom: "atencao" };
    case "Em execução":
      return { rotulo: "Em execução", tom: "atencao" };
    case "Confirmado":
      return { rotulo: "Confirmado", tom: "sucesso" };
    case "Reagendado":
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
    if (i.status === "Cancelado") continue;
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
