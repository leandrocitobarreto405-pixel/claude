import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa } from "@/lib/empresa.middleware";
import { cashPaidAmount, remainingAmount } from "@/lib/expenses";
import { despesaDeRota } from "@/lib/dre-quilometragem";
import {
  mesesAte,
  porCategoria,
  porMes,
  proximos30,
  round2,
  type ResumoFinanceiro,
} from "@/lib/financeiro";
import { monthEnd, monthStart, todayISO } from "@/lib/format";
import { STATUS_RECEBIDOS } from "@/lib/payments";
import { fetchReceivables } from "@/lib/receivables";

// Financeiro › Resumo: só admin, no servidor, com o cliente da própria pessoa (RLS). Entrou e saiu
// pela data do pagamento (caixa); OS de teste ficam fora. Só totais voltam para a tela.

export const resumoFinanceiro = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { mes: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input.mes)) throw new Error("Mês inválido.");
    return input;
  })
  .handler(async ({ data, context }): Promise<ResumoFinanceiro> => {
    const db = context.supabase;
    const hoje = todayISO();
    const meses = mesesAte(data.mes, 6);
    const de = meses[0]!.de;
    const ate = meses[meses.length - 1]!.ate;
    const mesAtual = { de: monthStart(data.mes), ate: monthEnd(data.mes) };

    const [recebidosRes, despesasRes, aPagarRes, aReceber] = await Promise.all([
      db
        .from("payments")
        .select("payment_date, gross_amount, work_order:work_order_id ( eh_teste )")
        .eq("is_active", true)
        .in("payment_status", STATUS_RECEBIDOS)
        .gte("payment_date", de)
        .lte("payment_date", ate),
      db
        .from("expenses")
        .select(
          "category, status, paid_amount, actual_amount, payment_date, reference_key, deleted_at",
        )
        .is("deleted_at", null)
        .gte("payment_date", de)
        .lte("payment_date", ate),
      db
        .from("expenses")
        .select("due_date, status, expected_amount, paid_amount, actual_amount")
        .is("deleted_at", null)
        .not("status", "in", "(Pago,Cancelado)"),
      fetchReceivables(db),
    ]);
    for (const r of [recebidosRes, despesasRes, aPagarRes]) if (r.error) throw r.error;

    type Pag = {
      payment_date: string | null;
      gross_amount: number | null;
      work_order: { eh_teste: boolean } | null;
    };
    const recebidos = ((recebidosRes.data ?? []) as unknown as Pag[])
      .filter((p) => !p.work_order?.eh_teste)
      .map((p) => ({ data: p.payment_date, valor: round2(Number(p.gross_amount ?? 0)) }));
    type Desp = {
      category: string;
      status: string;
      paid_amount: number | null;
      actual_amount: number | null;
      payment_date: string | null;
      reference_key: string | null;
    };
    // Quilometragem das rotas já entra no DRE como custo de deslocamento; aqui é caixa, então conta.
    const despesas = ((despesasRes.data ?? []) as unknown as Desp[]).map((e) => ({
      data: e.payment_date,
      valor: round2(cashPaidAmount(e)),
      categoria: despesaDeRota(e) ? "Quilometragem" : e.category,
    }));
    const noMes = (d: string | null) => !!d && d >= mesAtual.de && d <= mesAtual.ate;
    const entrou = round2(recebidos.filter((r) => noMes(r.data)).reduce((s, r) => s + r.valor, 0));
    const saiu = round2(despesas.filter((d) => noMes(d.data)).reduce((s, d) => s + d.valor, 0));

    const aPagar = (
      (aPagarRes.data ?? []) as unknown as {
        due_date: string | null;
        status: string;
        expected_amount: number | null;
        paid_amount: number | null;
        actual_amount: number | null;
      }[]
    ).map((e) => ({
      due_date: e.due_date,
      status: e.status,
      restante: round2(remainingAmount({ ...e, expected_amount: Number(e.expected_amount ?? 0) })),
    }));

    return {
      mes: data.mes,
      entrou,
      saiu,
      saldo: round2(entrou - saiu),
      quantidadeRecebimentos: recebidos.filter((r) => noMes(r.data)).length,
      porMes: porMes(meses, recebidos, despesas),
      porCategoria: porCategoria(despesas.filter((d) => noMes(d.data))),
      proximos: proximos30(hoje, aReceber.items, aPagar),
    };
  });
