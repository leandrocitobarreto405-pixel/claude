import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireEmpresa } from "@/lib/empresa.middleware";
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

export type DescontoCliente = { pct: number; rotulo: string } | { erro: string };

/**
 * Descontos que o cliente tem direito (mesma regra da Alice): campanha recebida há até 30 dias
 * com condição em % ainda válida, ou indicação/crédito de indicação. Nunca os dois juntos.
 */
export const descontosDoCliente = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { telefone: string }) => ({ telefone: String(input.telefone ?? "") }))
  .handler(async ({ data }): Promise<{ campanha: DescontoCliente; indicacao: DescontoCliente }> => {
    const { contextoEmpresa } = await import("@/lib/request-db.server");
    const { lerMarketing, descontoPermitido } = await import("@/lib/alice/marketing.server");
    const { db, empresaId } = contextoEmpresa();
    const m = await lerMarketing({
      admin: db,
      empresaId,
      leadId: null,
      contatoId: null,
      agora: new Date(),
      telefone: data.telefone.replace(/\D/g, "") || null,
    });
    return {
      campanha: descontoPermitido(m, "campanha"),
      indicacao: descontoPermitido(m, "indicacao"),
    };
  });
