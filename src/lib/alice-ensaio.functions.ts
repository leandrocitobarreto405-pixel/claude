/** Ensaios da Alice (só administrador): nada é enviado nem gravado. */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa } from "@/lib/empresa.middleware";
import type { ResultadoCenario } from "@/lib/alice/ensaio-nome.server";
import type { ResultadoRespostas } from "@/lib/alice/ensaio-respostas.server";
import type { EnsaioCusto } from "@/lib/alice/ensaio-custo.server";
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

/** Ensaio das regras de 26/10 (respostas do cliente e tecido): nada é enviado nem gravado. */
export const ensaiarRespostasFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, comRecurso])
  .handler(async ({ context }): Promise<ResultadoRespostas[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { rodarEnsaioRespostas } = await import("@/lib/alice/ensaio-respostas.server");
    return rodarEnsaioRespostas(supabaseAdmin, context.empresaId);
  });

/** Ensaio de custo (ideias de 26/10): antes x depois, mensagem a mensagem; grava o resultado. */
export const ensaiarCustoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, comRecurso])
  .handler(async ({ context }): Promise<EnsaioCusto> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { rodarEnsaioCusto } = await import("@/lib/alice/ensaio-custo.server");
    return rodarEnsaioCusto(supabaseAdmin, context.empresaId);
  });
