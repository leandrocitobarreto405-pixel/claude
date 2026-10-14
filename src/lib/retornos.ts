// Regras da tela Retornos (sem acesso a banco, para poder testar).
import { TZ } from "@/lib/format";

export type RetornoBase = { scheduled_at: string; responsavel: string };

/** Dia (AAAA-MM-DD) em São Paulo de um instante ISO. */
export function diaSP(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Da equipe primeiro, Alice por último; dentro de cada um, pelo horário. */
export function ordenarRetornos<T extends RetornoBase>(lista: T[]): T[] {
  return [...lista].sort((a, b) => {
    if (a.responsavel !== b.responsavel) return a.responsavel === "alice" ? 1 : -1;
    return a.scheduled_at.localeCompare(b.scheduled_at);
  });
}

/**
 * Hoje, vencidos (até 3 dias; mais que isso o banco já expirou) e próximos, pelo dia de São
 * Paulo. "Vencido" é o que já passou do horário e não é de hoje.
 */
export function agruparRetornos<T extends RetornoBase>(
  lista: T[],
  agora: Date,
): { hoje: T[]; vencidos: T[]; proximos: T[] } {
  const hoje = diaSP(agora.toISOString());
  const limite = agora.getTime() - 3 * 24 * 3600_000;
  const hojeL: T[] = [];
  const vencidos: T[] = [];
  const proximos: T[] = [];
  for (const r of lista) {
    const dia = diaSP(r.scheduled_at);
    const quando = new Date(r.scheduled_at).getTime();
    if (dia === hoje) hojeL.push(r);
    else if (dia < hoje) {
      if (quando >= limite) vencidos.push(r);
    } else proximos.push(r);
  }
  return {
    hoje: ordenarRetornos(hojeL),
    vencidos: ordenarRetornos(vencidos),
    proximos: ordenarRetornos(proximos),
  };
}

export type FiltroRetornos = "equipe" | "alice" | "todas";

export function filtrarRetornos<T extends RetornoBase>(lista: T[], de: FiltroRetornos): T[] {
  return lista.filter((f) => de === "todas" || f.responsavel === de);
}
