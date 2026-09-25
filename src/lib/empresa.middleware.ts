import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Exige empresa ativa válida (confirmada pelo banco) e disponibiliza o contexto da empresa
 * para os módulos de servidor chamados pela função.
 */
export const requireEmpresa = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase.rpc("empresa_ativa" as never);
    if (error) throw error;
    const empresaId = (data as string | null) ?? null;
    if (!empresaId) throw new Error("Selecione uma empresa para continuar.");

    const { executarNaEmpresa } = await import("./request-db.server");
    return executarNaEmpresa({ db: context.supabase, empresaId, userId: context.userId }, () =>
      next({ context: { empresaId } }),
    );
  });

/** Como requireEmpresa, mas só para administradores da empresa (ou da Nexa). */
export const requireAdminEmpresa = createMiddleware({ type: "function" })
  .middleware([requireEmpresa])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase.rpc("meu_papel" as never);
    if (error) throw error;
    if (data !== "admin")
      throw new Error("Apenas administradores podem alterar esta configuração.");
    return next();
  });
