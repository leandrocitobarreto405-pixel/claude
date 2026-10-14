import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Cliente do banco usado pelas consultas financeiras: o do navegador (telas) ou o da requisição
 * (funções do servidor). Os dois rodam como a pessoa logada, sob o RLS da empresa ativa.
 */
export type Banco = SupabaseClient<Database>;
