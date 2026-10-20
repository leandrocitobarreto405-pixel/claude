/**
 * "Marcar como paga" em Comissões a pagar: lança a despesa "Comissões" da vendedora no mês (ou
 * marca como paga a que já existir), sem duplicar — uma por vendedora e mês, pela chave
 * comissao:<vendedora>:<mês>, que o banco já recusa repetida.
 */
import { supabase } from "@/integrations/supabase/client";
import { todayISO } from "@/lib/format";
import { despesaDaComissao, referenciaComissao, type ComissaoVendedora } from "@/lib/comissoes";

export type ResultadoPagamento = "lancada" | "atualizada" | "ja_paga";

export async function marcarComissaoPaga(
  c: ComissaoVendedora,
  mes: string,
  hoje = todayISO(),
): Promise<ResultadoPagamento> {
  if (!(c.comissao > 0)) throw new Error("Não há comissão a pagar para esta vendedora no mês.");
  const despesa = despesaDaComissao(c, mes, hoje);
  const buscar = () =>
    supabase
      .from("expenses")
      .select("id, status, paid_amount, deleted_at")
      .eq("reference_key", referenciaComissao(c.salespersonId, mes))
      .maybeSingle();

  const { data: existente, error } = await buscar();
  if (error) throw new Error("Não foi possível conferir a despesa da comissão.");
  if (!existente) {
    const { error: insErr } = await supabase.from("expenses").insert(despesa);
    if (!insErr) return "lancada";
    // Outra pessoa lançou ao mesmo tempo (chave repetida): segue para atualizar.
    if ((insErr as { code?: string }).code !== "23505")
      throw new Error("Não foi possível lançar a despesa da comissão.");
  }
  const atual = existente ?? (await buscar()).data;
  if (!atual) throw new Error("Não foi possível lançar a despesa da comissão.");
  if (
    !atual.deleted_at &&
    atual.status === "Pago" &&
    Number(atual.paid_amount ?? 0) >= despesa.paid_amount
  )
    return "ja_paga";
  const { error: updErr } = await supabase
    .from("expenses")
    .update({
      status: "Pago",
      paid_amount: despesa.paid_amount,
      actual_amount: despesa.actual_amount,
      expected_amount: despesa.expected_amount,
      payment_date: despesa.payment_date,
      due_date: despesa.due_date,
      deleted_at: null,
    })
    .eq("id", atual.id);
  if (updErr) throw new Error("Não foi possível marcar a comissão como paga.");
  return "atualizada";
}
