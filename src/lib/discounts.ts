import { supabase } from "@/integrations/supabase/client";
import { logOsHistory } from "@/lib/os";
import { brl } from "@/lib/format";

/** Motivos padrão para dispensar um saldo a receber. */
export const DISCOUNT_REASONS = [
  "Desconto no Pix",
  "Desconto negociado",
  "Arredondamento",
  "Outro",
] as const;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Dispensa (total ou parcialmente) o saldo pendente de um atendimento.
 * O desconto não gera receita nem despesa: apenas reduz o valor a receber.
 */
export async function applyVisitDiscount(args: {
  visitId: string;
  workOrderId: string;
  amount: number;
  reason: string;
  notes?: string | null;
  userId?: string | null;
}) {
  const amount = round2(Math.max(0, args.amount));
  if (amount <= 0) throw new Error("Informe um valor de desconto maior que zero.");

  const { data: atual, error: readError } = await supabase
    .from("visits")
    .select("discount_amount")
    .eq("id", args.visitId)
    .single();
  if (readError) throw readError;

  const total = round2(Number(atual?.discount_amount ?? 0) + amount);

  const { error } = await supabase
    .from("visits")
    .update({
      discount_amount: total,
      discount_reason: args.reason,
      discount_notes: args.notes?.trim() || null,
      discount_at: new Date().toISOString(),
      discount_by: args.userId ?? null,
    })
    .eq("id", args.visitId);
  if (error) throw error;

  await logOsHistory({
    workOrderId: args.workOrderId,
    eventType: "Desconto concedido",
    description: `Saldo dispensado de ${brl(amount)} — ${args.reason}`,
    details: { visit_id: args.visitId, amount, reason: args.reason, notes: args.notes ?? null },
    userId: args.userId ?? null,
  });
}

/** Desfaz o desconto: o saldo volta para "A receber". */
export async function clearVisitDiscount(args: {
  visitId: string;
  workOrderId: string;
  userId?: string | null;
}) {
  const { error } = await supabase
    .from("visits")
    .update({
      discount_amount: 0,
      discount_reason: null,
      discount_notes: null,
      discount_at: null,
      discount_by: null,
    })
    .eq("id", args.visitId);
  if (error) throw error;

  await logOsHistory({
    workOrderId: args.workOrderId,
    eventType: "Desconto removido",
    description: "Desconto desfeito: o saldo volta a constar em A receber.",
    details: { visit_id: args.visitId },
    userId: args.userId ?? null,
  });
}
