// Regras da aba Agenda › Serviços (sem acesso a banco, para poder testar).
import type { TomChip } from "@/components/nexa";

/** Um serviço "para concluir" é qualquer um que não foi concluído nem cancelado. */
export const STATUS_ENCERRADOS = ["Concluído", "Cancelado"];

export function emAberto(status: string): boolean {
  return !STATUS_ENCERRADOS.includes(status);
}

/** Dias entre a data marcada e hoje (0 para hoje ou futuro). */
export function diasDeAtraso(dataMarcada: string, hoje: string): number {
  const a = Date.UTC(
    Number(dataMarcada.slice(0, 4)),
    Number(dataMarcada.slice(5, 7)) - 1,
    Number(dataMarcada.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(hoje.slice(0, 4)),
    Number(hoje.slice(5, 7)) - 1,
    Number(hoje.slice(8, 10)),
  );
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** "Hoje", "Atrasado há 1 dia", "Atrasado há 3 dias". */
export function textoAtraso(dias: number): { rotulo: string; tom: TomChip } {
  if (dias <= 0) return { rotulo: "Hoje", tom: "neutro" };
  return { rotulo: dias === 1 ? "Atrasado há 1 dia" : `Atrasado há ${dias} dias`, tom: "problema" };
}

/** Para concluir: o mais atrasado primeiro; no mesmo dia, pelo horário. */
export function ordenarParaConcluir<T extends { scheduled_date: string; scheduled_time: string }>(
  lista: T[],
): T[] {
  return [...lista].sort(
    (a, b) =>
      a.scheduled_date.localeCompare(b.scheduled_date) ||
      a.scheduled_time.localeCompare(b.scheduled_time),
  );
}

/** Realizados agrupados por dia de conclusão, do mais recente para o mais antigo. */
export function agruparPorDia<
  T extends { completion_date: string | null; completion_time?: string | null },
>(lista: T[]): [string, T[]][] {
  const mapa = new Map<string, T[]>();
  for (const v of lista) {
    const dia = v.completion_date ?? "";
    mapa.set(dia, [...(mapa.get(dia) ?? []), v]);
  }
  return [...mapa.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dia, itens]) => [
      dia,
      [...itens].sort((a, b) => (b.completion_time ?? "").localeCompare(a.completion_time ?? "")),
    ]);
}

export type EtiquetaPagamento = { rotulo: string; tom: TomChip; saldo: number };

/** Etiqueta do serviço realizado: "Pago" ou "A receber R$ x" (saldo em aberto da OS neste serviço). */
export function etiquetaPagamento(saldo: number | undefined): EtiquetaPagamento {
  if (saldo && saldo > 0) {
    return {
      rotulo: `A receber ${saldo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      tom: "atencao",
      saldo,
    };
  }
  return { rotulo: "Pago", tom: "sucesso", saldo: 0 };
}
