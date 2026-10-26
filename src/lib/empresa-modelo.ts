// Empresa-modelo neutra (Fase B, item 4): empresa inativa de onde as novas copiam catálogos e
// mensagens padrão. Não é cliente: fica fora das listas do Painel Nexa.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function idDaEmpresaModelo(db: SupabaseClient<Database>): Promise<string | null> {
  const { data } = await db
    .from("configuracoes_plataforma")
    .select("valor")
    .eq("chave", "empresa_modelo_id")
    .maybeSingle();
  return typeof data?.valor === "string" ? data.valor : null;
}

export function semEmpresaModelo<T extends { id: string }>(lista: T[], modelo: string | null): T[] {
  return modelo ? lista.filter((e) => e.id !== modelo) : lista;
}
