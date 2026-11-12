import type { Uso } from "@/lib/comercial/ficha";
import { linhaDaChamada, type OrigemChamada } from "@/lib/ia-chamadas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * Grava o custo de uma chamada de IA em ia_chamadas (11/11). Nunca derruba quem chamou: falha na
 * gravação só vai para o log. `uso` nulo = a chamada falhou (linha sem custo, ok = false).
 */
export async function registrarChamadaIa(
  db: Db,
  o: {
    empresaId: string;
    origem: OrigemChamada;
    modelo: string;
    uso: Uso | null;
    referencia?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await db.from("ia_chamadas").insert(linhaDaChamada(o));
    if (error) console.error("ia_chamadas: custo não gravado", error.code ?? error.message);
  } catch (e) {
    console.error("ia_chamadas: custo não gravado", e instanceof Error ? e.message : e);
  }
}
