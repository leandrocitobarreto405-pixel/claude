import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { exigirNexaAdmin } from "@/lib/nexa-admin";

/**
 * Funções do Painel Nexa: exige login e nexa_admin (conferido pelo banco). Não depende da
 * empresa ativa: o painel é um espaço separado das empresas.
 */
export const requireNexaAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    await exigirNexaAdmin(context.supabase);
    return next();
  });
