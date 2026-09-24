import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { QuoteInput } from "./quotes.server";

export const salvarOrcamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: QuoteInput) => input)
  .handler(async ({ data, context }) => {
    const { saveQuote } = await import("./quotes.server");
    return saveQuote(context.supabase, data, context.userId ?? null);
  });

export const duplicarOrcamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => ({ id: String(input.id) }))
  .handler(async ({ data, context }) => {
    const { duplicateQuote } = await import("./quotes.server");
    return duplicateQuote(context.supabase, data.id, context.userId ?? null);
  });

export const estimarKmPorCep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cep: string }) => ({ cep: String(input.cep ?? "") }))
  .handler(async ({ data, context }) => {
    const { estimateKmByCep } = await import("./quotes.server");
    return estimateKmByCep(context.supabase, data.cep);
  });

export const custoFixoPorServico = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { fixedCostPerService } = await import("./quotes.server");
    return fixedCostPerService(context.supabase);
  });
