import { createMiddleware } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import { rotuloRecurso, type Recurso } from "@/lib/recursos";

/** Mensagem de recurso fora do plano (a tela mostra o cadeado e "Quero mudar de plano"). */
export function erroForaDoPlano(r: Recurso) {
  return new Error(
    `${rotuloRecurso(r)} não está no plano da empresa. Fale com a Nexa para mudar de plano.`,
  );
}

/** Exige que o plano da empresa aberta tenha o recurso (conferido pelo banco). */
export function requireRecurso(recurso: Recurso) {
  return createMiddleware({ type: "function" })
    .middleware([requireEmpresa])
    .server(async ({ next, context }) => {
      const { data, error } = await context.supabase.rpc(
        "tem_recurso" as never,
        {
          _recurso: recurso,
        } as never,
      );
      if (error || data !== true) throw erroForaDoPlano(recurso);
      return next();
    });
}
