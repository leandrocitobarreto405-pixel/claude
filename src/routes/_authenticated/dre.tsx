import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { AbasDeRota, Botao, Recolhido } from "@/components/nexa";
import { OrigensDaVenda } from "@/components/financeiro/origens";
import { ABAS_DE_TELA, abasPermitidas } from "@/lib/menu";
import { useContextoTenant } from "@/lib/tenant";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMonthSummary } from "@/lib/reports";
import { textoPercentuais } from "@/lib/comissao-nexa";
import { quintoDiaUtil } from "@/lib/comissoes";
import { brl, currentMonth, dateBR, monthLabelPT } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dre")({
  // `?bloco=origens` abre o bloco Origens da venda (endereço antigo /origens).
  validateSearch: (s: Record<string, unknown>): { bloco?: "origens" } =>
    s["bloco"] === "origens" ? { bloco: "origens" } : {},
  head: () => ({
    meta: [
      { title: "Relatórios: DRE — Nexa OS" },
      {
        name: "description",
        content: "Demonstrativo mensal por competência: receita, custos e lucro líquido.",
      },
      { property: "og:title", content: "Relatórios: DRE — Nexa OS" },
      {
        property: "og:description",
        content: "Demonstrativo mensal por competência: receita, custos e lucro líquido.",
      },
    ],
  }),
  component: DRE,
});

function DRE() {
  const { bloco } = Route.useSearch();
  const [mes, setMes] = useState(currentMonth());
  const { data: r } = useMonthSummary(mes);
  const { data: tenant } = useContextoTenant();
  const papel = tenant?.ativa?.papel ?? null;
  const souNexa = tenant?.souNexa === true;
  // Vendas das atendentes da Nexa: a comissão delas é paga à Nexa e aparece separada.
  const temNexa = (r?.nexa.recebido ?? 0) > 0;
  const pctNexa = r?.nexa.percentuais.length ? ` (${textoPercentuais(r.nexa.percentuais)})` : "";
  const notaComissao = `competência: valores recebidos no mês · pagamento no 5º dia útil do mês seguinte (${dateBR(quintoDiaUtil(mes))})`;

  return (
    <>
      <PageHeader
        title="Financeiro"
        description={`DRE gerencial · competência de ${monthLabelPT(mes)}`}
      />
      <AbasDeRota
        abas={abasPermitidas(ABAS_DE_TELA.financeiro, papel, souNexa)}
        rotulo="Financeiro"
        className="mb-6"
      />

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

      {(r?.receivableCompleted ?? 0) > 0 ? (
        <div
          role="status"
          className="mb-6 flex items-center gap-3 rounded-card border border-atencao-foreground/30 bg-atencao p-4 text-atencao-foreground"
        >
          <AlertTriangle className="size-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <strong>{brl(r?.receivableCompleted)}</strong> em serviços concluídos sem recebimento.
            Eles não entram na receita até o pagamento ser registrado.
          </p>
          <Botao asChild variante="claro" className="shrink-0">
            <Link to="/a-receber" search={{ aba: "concluido" }}>
              Registrar
            </Link>
          </Botao>
        </div>
      ) : null}

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
          Receita, taxas, repasse a parceiros e comissões entram no mês em que o valor foi recebido
          (data do pagamento). As despesas entram no mês de competência, mas somente pelo valor já
          pago — uma despesa de um mês paga no mês seguinte aparece aqui automaticamente.
        </p>
        <table className="w-full text-sm">
          <tbody>
            <Line
              label="Vendido no mês (serviços do mês, sem o repasse a parceiros)"
              value={r?.soldNet}
              muted
            />
            <Line label="Serviços realizados no mês (valor)" value={r?.servicesValue} muted />
            {(r?.repasse ?? 0) !== 0 ? (
              <>
                <Line
                  label="Recebido dos clientes no mês"
                  value={(r?.revenue ?? 0) + (r?.repasse ?? 0)}
                  muted
                />
                <Line label="(-) Repasse a parceiros (terceirizados)" value={-(r?.repasse ?? 0)} />
              </>
            ) : null}
            <Line
              label="(=) Receita recebida no mês"
              value={r?.revenue}
              strong
              nota="competência: valores recebidos no mês"
            />
            <Line label="(-) Taxas de pagamento" value={-(r?.fees ?? 0)} />
            {temNexa ? (
              <Line
                label={`(-) Comissão Nexa${pctNexa}`}
                value={-(r?.nexa.comissao ?? 0)}
                nota={notaComissao}
              />
            ) : null}
            {!temNexa || (r?.commissionsOthers ?? 0) !== 0 ? (
              <Line
                label="(-) Comissões de vendas"
                value={-(r?.commissionsOthers ?? 0)}
                nota={notaComissao}
              />
            ) : null}
            <Line label="(-) Custo de deslocamento" value={-(r?.mileage ?? 0)} />
            {(r?.mileageExpensesPaid ?? 0) > 0 ? (
              <p className="pb-1 text-xs text-muted-foreground">
                Quilometragem paga ao técnico no mês: {brl(r?.mileageExpensesPaid)} (já está no
                custo de deslocamento, não entra de novo nas despesas).
              </p>
            ) : null}
            {(r?.repasseExpensesPaid ?? 0) > 0 ? (
              <p className="pb-1 text-xs text-muted-foreground">
                Repasse pago a parceiros no mês: {brl(r?.repasseExpensesPaid)} (já descontado da
                receita, não entra de novo nas despesas).
              </p>
            ) : null}
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
        {temNexa ? (
          <section className="card-surface p-5">
            <h2 className="mb-1 text-lg font-semibold">Comissão Nexa</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Vendas das atendentes da Nexa (recebido dos serviços do mês). A comissão é paga à
              Nexa.
            </p>
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(r?.nexa.porVendedora ?? {})
                  .sort((a, b) => b[1].recebido - a[1].recebido)
                  .map(([nome, v]) => (
                    <Line key={nome} label={`${nome} vendeu`} value={v.recebido} />
                  ))}
                <Line label="Total vendido pela equipe Nexa" value={r?.nexa.recebido} muted />
                <Line label={`Comissão Nexa${pctNexa}`} value={r?.nexa.comissao} strong />
              </tbody>
            </table>
          </section>
        ) : null}
        {!temNexa || Object.keys(r?.commissionsOthersBySalesperson ?? {}).length > 0 ? (
          <Breakdown title="Comissões por vendedora" data={r?.commissionsOthersBySalesperson} />
        ) : null}
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

      <Recolhido titulo="Origens da venda" abertoInicial={bloco === "origens"} className="mb-6">
        <div className="p-4">
          <OrigensDaVenda />
        </div>
      </Recolhido>
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
  nota,
}: {
  label: string;
  value: number | undefined;
  strong?: boolean;
  muted?: boolean;
  /** Linha pequena embaixo do rótulo (ex.: a competência). */
  nota?: string;
}) {
  return (
    <tr className="border-t border-border">
      <td
        className={`py-2 ${muted ? "text-muted-foreground" : ""} ${strong ? "font-semibold" : ""}`}
      >
        {label}
        {nota ? (
          <span className="block text-xs font-normal text-muted-foreground">{nota}</span>
        ) : null}
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
