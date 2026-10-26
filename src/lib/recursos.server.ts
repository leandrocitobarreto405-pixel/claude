import type { SupabaseClient } from "@supabase/supabase-js";
import type { Recurso } from "@/lib/recursos";

/**
 * Rotinas do servidor (chave de serviço): o plano da empresa tem o recurso? Em erro, não roda
 * (rotina que envia mensagem ou gasta IA só roda com o recurso confirmado).
 */
export async function empresaTemRecurso(
  db: SupabaseClient,
  empresaId: string,
  recurso: Recurso,
): Promise<boolean> {
  const { data, error } = await db.rpc(
    "empresa_tem_recurso" as never,
    {
      _emp: empresaId,
      _recurso: recurso,
    } as never,
  );
  return !error && data === true;
}
