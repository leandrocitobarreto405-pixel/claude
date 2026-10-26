import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireRecurso } from "@/lib/recurso.middleware";

/** Rotas e km: recurso do plano (Profissional em diante). */
const comRecurso = requireRecurso("deslocamento_rotas");
import { calculateDayRoute } from "./route-calc.server";
import { rotaForaDoPlano, syncDailyRoute, type RouteSyncResult } from "./route-auto.server";

export const calcularRotaDoDia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, comRecurso])
  .inputValidator((input: { date: string; technicianId: string | null }) => ({
    date: String(input.date),
    technicianId: input.technicianId ? String(input.technicianId) : null,
  }))
  .handler(async ({ data, context }) => calculateDayRoute(context.supabase, data));

export const sincronizarRotaDoDia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { date: string; technicianId: string | null; source?: string }) => ({
    date: String(input.date),
    technicianId: input.technicianId ? String(input.technicianId) : null,
    source: input.source === "manual" ? ("manual" as const) : ("automática" as const),
  }))
  .handler(async ({ data, context }): Promise<RouteSyncResult> => {
    // Chamada também ao concluir serviço: sem rotas/km no plano, só pula (não trava a OS).
    const { data: temRotas } = await context.supabase.rpc(
      "tem_recurso" as never,
      {
        _recurso: "deslocamento_rotas",
      } as never,
    );
    if (temRotas !== true) return rotaForaDoPlano();
    return syncDailyRoute(context.supabase, {
      date: data.date,
      technicianId: data.technicianId,
      source: data.source,
    });
  });

export const reprocessarRotasComErro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, comRecurso])
  .inputValidator((input?: { days?: number }) => ({ days: Number(input?.days ?? 60) }))
  .handler(async ({ data, context }) => {
    const { retryFailedRoutes } = await import("./route-auto.server");
    return retryFailedRoutes(context.supabase, { days: data.days, limit: 30 });
  });

export const fecharQuilometragemDoMes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, comRecurso])
  .inputValidator((input: { month: string; technicianId?: string | null }) => ({
    month: String(input.month).slice(0, 7),
    technicianId: input.technicianId ? String(input.technicianId) : null,
  }))
  .handler(async ({ data, context }) => {
    const { closeMonthlyMileage } = await import("./route-auto.server");
    return closeMonthlyMileage(context.supabase, {
      month: data.month,
      technicianId: data.technicianId,
    });
  });

export const sugerirDiasPorCep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cep: string }) => ({ cep: String(input.cep ?? "").replace(/\D/g, "") }))
  .handler(async ({ data, context }) => {
    const { suggestDaysByCep } = await import("./route-suggest.server");
    return suggestDaysByCep(context.supabase, { cep: data.cep, days: 30 });
  });

export const consolidarGastosDoTecnico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string; technicianId?: string | null }) => ({
    month: String(input.month).slice(0, 7),
    technicianId: input.technicianId ? String(input.technicianId) : null,
  }))
  .handler(async ({ data, context }) => {
    const { consolidateTechnicianExpenses } = await import("./technician-expenses.server");
    return consolidateTechnicianExpenses(context.supabase, {
      month: data.month,
      technicianId: data.technicianId,
    });
  });
