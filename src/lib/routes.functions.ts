import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calculateDayRoute } from "./route-calc.server";
import { syncDailyRoute } from "./route-auto.server";

export const calcularRotaDoDia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
  .handler(async ({ data, context }) =>
    syncDailyRoute(context.supabase, {
      date: data.date,
      technicianId: data.technicianId,
      source: data.source,
    }),
  );

export const reprocessarRotasComErro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { days?: number }) => ({ days: Number(input?.days ?? 60) }))
  .handler(async ({ data, context }) => {
    const { retryFailedRoutes } = await import("./route-auto.server");
    return retryFailedRoutes(context.supabase, { days: data.days, limit: 30 });
  });

export const fecharQuilometragemDoMes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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


