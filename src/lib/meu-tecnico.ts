// Técnico ligado ao login (technicians.user_id). Sem acesso a banco, para poder testar.
import type { Papel } from "@/lib/tenant";

export type TecnicoComLogin = { id: string; name: string; user_id?: string | null };

/** O cadastro de técnico deste login, se houver. */
export function tecnicoDoLogin<T extends TecnicoComLogin>(
  tecnicos: T[] | undefined,
  userId: string | null | undefined,
): T | null {
  if (!userId) return null;
  return tecnicos?.find((t) => t.user_id === userId) ?? null;
}

/**
 * Qual técnico a Agenda/Serviços mostra. Técnico: só o dele ("nenhum" quando o login ainda não
 * está ligado a um cadastro, para não mostrar nada). Admin e atendente: o filtro escolhido.
 */
export function filtroDeTecnico(
  papel: Papel | null,
  meuTecnicoId: string | null,
  escolhido: string,
): string {
  if (papel === "tecnico") return meuTecnicoId ?? "nenhum";
  return escolhido;
}

/** Rótulo do chip do técnico: o do próprio login aparece como "Meus serviços". */
export function rotuloDoTecnico(nome: string, id: string, meuTecnicoId: string | null): string {
  return id === meuTecnicoId ? "Meus serviços" : nome;
}

/** O técnico não vê valores em R$ na Agenda e nos Serviços. */
export function mostraValores(papel: Papel | null): boolean {
  return papel !== "tecnico";
}
