/** Ensaio da regra do nome (só administrador): nada é enviado nem gravado. */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa } from "@/lib/empresa.middleware";
import type { ResultadoCenario } from "@/lib/alice/ensaio-nome.server";
import { requireRecurso } from "@/lib/recurso.middleware";

/** alice: recurso do plano (Essencial não tem). */
const comRecurso = requireRecurso("alice");

export const ensaiarNomeFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, comRecurso])
  .handler(async ({ context }): Promise<ResultadoCenario[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { rodarEnsaioNome } = await import("@/lib/alice/ensaio-nome.server");
    return rodarEnsaioNome(supabaseAdmin, context.empresaId);
  });
