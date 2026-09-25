import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMonthSummary } from "@/lib/reports";
import { brl, currentMonth, dateBR, monthLabelPT } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dre")({
  head: () => ({
    meta: [
      { title: "DRE gerencial — Gestão Estofados" },
      {
        name: "description",
        content: "Demonstrativo mensal por competência: receita, custos e lucro líquido.",
      },
      { property: "og:title", content: "DRE gerencial — Gestão Estofados" },
      {
        property: "og:description",
        content: "Demonstrativo mensal por competência: receita, custos e lucro líquido.",
      },
    ],
  }),
  component: DRE,
});

function DRE() {
  const [mes, setMes] = useState(currentMonth());
  const { data: r } = useMonthSummary(mes);

  return (
    <>
      <PageHeader title="DRE gerencial" description={`Competência de ${monthLabelPT(mes)}`} />

      <div className="card-surface mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="mes">Mês de competência</Label>
          <Input
            id="mes"
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="w-[170px]"
          />
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          label="Receita recebida"
          value={brl(r?.revenue)}
          hint="Somente pagamentos efetivamente recebidos"
        />
        <Card label="Custos variáveis" value={brl(r?.variableCosts)} />
        <Card
          label="Despesas pagas"
          value={brl(r?.fixedCosts)}
          hint={
            (r?.expensesUnpaid ?? 0) > 0
              ? `${brl(r?.expensesUnpaid)} ainda não pagos (fora do resultado)`
              : "Somente despesas efetivamente pagas"
          }
        />
        <Card
          label="Lucro líquido"
          value={brl(r?.netProfit)}
          hint={`Margem de ${(r?.netMargin ?? 0).toFixed(1).replace(".", ",")}%`}
        />
      </div>

      <section className="card-surface mb-6 p-5">
        <h2 className="mb-1 text-lg font-semibold">Demonstrativo por competência</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          A receita considera apenas o que foi recebido, alocado no mês em que o serviço foi
          concluído. As despesas entram no mês de competência, mas somente pelo valor já pago — uma
          despesa de um mês paga no mês seguinte aparece aqui automaticamente.
        </p>
        <table className="w-full text-sm">
          <tbody>
            <Line label="Vendas fechadas no mês" value={r?.soldGross} muted />
            <Line label="Serviços realizados no mês (valor)" value={r?.servicesValue} muted />
            <Line label="(=) Receita recebida dos serviços do mês" value={r?.revenue} strong />
            <Line label="(-) Taxas de pagamento" value={-(r?.fees ?? 0)} />
            <Line label="(-) Comissões de vendas" value={-(r?.commissions ?? 0)} />
            <Line label="(-) Custo de deslocamento" value={-(r?.mileage ?? 0)} />
            {(r?.cmv ?? 0) > 0 ? (
              <Line label="(-) Produtos usados nos serviços" value={-(r?.cmv ?? 0)} />
            ) : null}

            <Line
              label="(=) Margem de contribuição"
              value={(r?.revenue ?? 0) - (r?.variableCosts ?? 0)}
              strong
            />
            <Line label="(-) Custos e despesas pagas" value={-(r?.fixedCosts ?? 0)} />
            <Line label="(=) Lucro líquido do mês" value={r?.netProfit} strong />
            <Line label="Serviços do mês ainda não recebidos" value={r?.servicesPending} muted />
          </tbody>
        </table>
      </section>

      <section className="card-surface mb-6 p-5">
        <h2 className="mb-1 text-lg font-semibold">Despesas pagas no mês</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Cada despesa da competência de {monthLabelPT(mes)} pelo valor efetivamente pago, na data
          em que o pagamento aconteceu.
        </p>
        {(r?.expensesPaidList?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma despesa paga neste mês.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Despesa</th>
                  <th className="pb-2 font-medium">Categoria</th>
                  <th className="pb-2 font-medium">Beneficiário</th>
                  <th className="pb-2 font-medium">Pagamento</th>
                  <th className="pb-2 text-right font-medium">Valor pago</th>
                </tr>
              </thead>
              <tbody>
                {(r?.expensesPaidList ?? []).map(({ expense, paid }) => (
                  <tr key={expense.id} className="border-t border-border">
                    <td className="py-2">
                      {expense.description}
                      {expense.status === "Parcialmente pago" ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (parcial de {brl(expense.expected_amount)})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2">{expense.category}</td>
                    <td className="py-2">{expense.beneficiary ?? "—"}</td>
                    <td className="py-2">{dateBR(expense.payment_date)}</td>
                    <td className="py-2 text-right">{brl(paid)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-2" colSpan={4}>
                    Total pago
                  </td>
                  <td className="py-2 text-right">{brl(r?.fixedCosts)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {Object.keys(r?.expensesPaidByCategory ?? {}).length > 0 ? (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold">Subtotais por categoria</h3>
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(r?.expensesPaidByCategory ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, val]) => (
                    <tr key={cat} className="border-t border-border">
                      <td className="py-2">{cat}</td>
                      <td className="py-2 text-right">{brl(val)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-5 rounded-xl bg-muted/50 p-4 text-sm">
          <p className="font-medium">Despesas ainda não pagas neste mês</p>
          <p className="mt-1 text-muted-foreground">
            {brl(r?.expensesUnpaid)} em aberto (pendentes, vencidas e saldo das parcialmente pagas).
            Este valor não entra no resultado; ele aparecerá no DRE de {monthLabelPT(mes)} assim que
            for pago, mesmo que o pagamento ocorra em outro mês.
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="Receita por origem da venda" data={r?.revenueByOrigin} />
        <Breakdown title="Receita por vendedora" data={r?.revenueBySalesperson} />
        <Breakdown title="Receita por tipo de serviço" data={r?.revenueByService} />
        <Breakdown title="Taxas por canal de pagamento" data={r?.feesByChannel} />
        <Breakdown title="Comissões por vendedora" data={r?.commissionsBySalesperson} />
        <section className="card-surface p-5">
          <h2 className="mb-3 text-lg font-semibold">Visão de caixa</h2>
          <table className="w-full text-sm">
            <tbody>
              <Line label="Recebimentos de serviços do mês" value={r?.received} />
              <Line label="Desembolso de despesas no mês" value={-(r?.cashOut ?? 0)} />
              <Line label="Resultado de caixa" value={r?.cashResult} strong />
              <Line label="Despesas em aberto" value={r?.expensesPending} muted />
              <Line label="Valores a receber" value={r?.receivable} muted />
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div className="card-surface p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: number | undefined;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <tr className="border-t border-border">
      <td
        className={`py-2 ${muted ? "text-muted-foreground" : ""} ${strong ? "font-semibold" : ""}`}
      >
        {label}
      </td>
      <td className={`py-2 text-right ${strong ? "font-semibold" : ""}`}>{brl(value ?? 0)}</td>
    </tr>
  );
}

function Breakdown({ title, data }: { title: string; data?: Record<string, number> | undefined }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <section className="card-surface p-5">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem dados no período.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k} className="border-t border-border">
                <td className="py-2">{k}</td>
                <td className="py-2 text-right">{brl(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
