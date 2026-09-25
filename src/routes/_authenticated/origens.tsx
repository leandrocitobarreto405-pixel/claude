import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/app-shell";
import { useOriginBreakdown, type OriginStat } from "@/lib/reports";
import {
  brl,
  currentMonth,
  dateBR,
  monthEnd,
  monthLabelPT,
  monthStart,
  todayISO,
  weekEnd,
  weekStart,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/origens")({
  head: () => ({
    meta: [
      { title: "Origens da venda — Nexa OS" },
      {
        name: "description",
        content: "Faturamento e clientes por origem da venda e por recorrência de cliente.",
      },
      { property: "og:title", content: "Origens da venda — Nexa OS" },
      {
        property: "og:description",
        content: "Faturamento e clientes por origem da venda e por recorrência de cliente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Origens,
});

type Modo = "dia" | "semana" | "mes" | "personalizado";

function baixarCSV(nome: string, linhas: (string | number)[][]) {
  const csv = linhas
    .map((l) =>
      l
        .map((c) => {
          const s = typeof c === "number" ? String(c).replace(".", ",") : c;
          return `"${s.replace(/"/g, '""')}"`;
        })
        .join(";"),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function Origens() {
  const [modo, setModo] = useState<Modo>("mes");
  const [mes, setMes] = useState(currentMonth());
  const [dia, setDia] = useState(todayISO());
  const [de, setDe] = useState(monthStart(currentMonth()));
  const [ate, setAte] = useState(monthEnd(currentMonth()));

  const { from, to, periodoLabel } = useMemo(() => {
    if (modo === "dia") return { from: dia, to: dia, periodoLabel: dateBR(dia) };
    if (modo === "semana") {
      const f = weekStart(dia);
      const t = weekEnd(dia);
      return { from: f, to: t, periodoLabel: `${dateBR(f)} a ${dateBR(t)}` };
    }
    if (modo === "personalizado") {
      const f = de <= ate ? de : ate;
      const t = de <= ate ? ate : de;
      return { from: f, to: t, periodoLabel: `${dateBR(f)} a ${dateBR(t)}` };
    }
    return { from: monthStart(mes), to: monthEnd(mes), periodoLabel: monthLabelPT(mes) };
  }, [modo, dia, de, ate, mes]);

  const { data, isLoading } = useOriginBreakdown(from, to);

  const google = data?.byOrigin.find((o) => o.origin.toLowerCase() === "google");
  const recorrente = data?.byRecurrence.find((o) => o.origin === "Cliente recorrente");

  return (
    <>
      <PageHeader
        title="Origens da venda"
        description={`${periodoLabel} · ${data?.totalServices ?? 0} serviço(s) concluído(s)`}
      />

      <div className="card-surface mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="modo">Período</Label>
          <select
            id="modo"
            value={modo}
            onChange={(e) => setModo(e.target.value as Modo)}
            className="h-10 w-[160px] rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="dia">Dia</option>
            <option value="semana">Semana</option>
            <option value="mes">Mês</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </div>
        {modo === "mes" ? (
          <div className="space-y-1">
            <Label htmlFor="mesf">Mês</Label>
            <Input
              id="mesf"
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="w-[170px]"
            />
          </div>
        ) : null}
        {modo === "dia" || modo === "semana" ? (
          <div className="space-y-1">
            <Label htmlFor="diaf">Data</Label>
            <Input
              id="diaf"
              type="date"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              className="w-[170px]"
            />
          </div>
        ) : null}
        {modo === "personalizado" ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="de">De</Label>
              <Input
                id="de"
                type="date"
                value={de}
                onChange={(e) => setDe(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ate">Até</Label>
              <Input
                id="ate"
                type="date"
                value={ate}
                onChange={(e) => setAte(e.target.value)}
                className="w-[160px]"
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="mb-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          label="Faturamento recebido"
          value={brl(data?.total)}
          hint={`${data?.totalPayments ?? 0} pagamento(s) · ${data?.totalCustomers ?? 0} cliente(s)`}
        />
        <Card
          label="Faturamento do Google"
          value={brl(google?.revenue ?? 0)}
          hint={`${google?.customers ?? 0} cliente(s) · ${(google?.share ?? 0).toFixed(1).replace(".", ",")}% do recebido`}
        />
        <Card
          label="Cliente recorrente (histórico)"
          value={brl(recorrente?.revenue ?? 0)}
          hint={`${recorrente?.customers ?? 0} cliente(s) · ${(recorrente?.share ?? 0).toFixed(1).replace(".", ",")}% do recebido`}
        />
        <Card
          label="Ticket médio por cliente"
          value={brl(data && data.totalCustomers > 0 ? data.total / data.totalCustomers : 0)}
        />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card
          label="Serviços realizados (valor)"
          value={brl(data?.servicesValue)}
          hint={`${data?.totalServices ?? 0} atendimento(s) · ${data?.totalOrders ?? 0} OS`}
        />
        <Card
          label="Ainda não recebido"
          value={brl(data?.pending)}
          hint="Saldos em aberto ficam em A receber (dispensados não contam)"
        />
        <div className="card-surface flex flex-col justify-center gap-2 p-5">
          <p className="text-sm text-muted-foreground">
            O faturamento acima considera somente pagamentos recebidos. Serviços sem pagamento
            aparecem em A receber.
          </p>
          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link to="/a-receber" search={{ aba: "concluido" }}>
              Ver A receber
            </Link>
          </Button>
        </div>
      </div>

      <StatTable
        title="Por origem da venda"
        rows={data?.byOrigin ?? []}
        loading={isLoading}
        fileName={`origens-${from}-a-${to}.csv`}
      />

      <StatTable
        title="Cliente novo x recorrente (pelo histórico)"
        rows={data?.byRecurrence ?? []}
        loading={isLoading}
        fileName={`recorrencia-${from}-a-${to}.csv`}
      />

      <section className="card-surface mb-6 p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Origem x recorrência (faturamento)</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              baixarCSV(`origem-x-recorrencia-${from}-a-${to}.csv`, [
                ["Origem", "Cliente novo", "Cliente recorrente", "Total"],
                ...(data?.cross ?? []).map((c) => [c.origin, c.novo, c.recorrente, c.total]),
              ])
            }
            disabled={!data || data.cross.length === 0}
          >
            Exportar CSV
          </Button>
        </div>
        {(data?.cross.length ?? 0) === 0 ? (
          <EmptyState
            title="Sem dados no período"
            description="Nenhum atendimento concluído nesse intervalo."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2">Origem</th>
                  <th className="py-2 text-right">Cliente novo</th>
                  <th className="py-2 text-right">Cliente recorrente</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(data?.cross ?? []).map((c) => (
                  <tr key={c.origin} className="border-t border-border">
                    <td className="py-2">{c.origin}</td>
                    <td className="py-2 text-right">{brl(c.novo)}</td>
                    <td className="py-2 text-right">{brl(c.recorrente)}</td>
                    <td className="py-2 text-right font-medium">{brl(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function StatTable({
  title,
  rows,
  loading,
  fileName,
}: {
  title: string;
  rows: OriginStat[];
  loading: boolean;
  fileName: string;
}) {
  return (
    <section className="card-surface mb-6 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={rows.length === 0}
          onClick={() =>
            baixarCSV(fileName, [
              ["Origem", "Clientes", "Serviços", "Faturamento", "Ticket médio", "% do total"],
              ...rows.map((r) => [
                r.origin,
                r.customers,
                r.services,
                r.revenue,
                r.ticket,
                Number(r.share.toFixed(1)),
              ]),
            ])
          }
        >
          Exportar CSV
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sem dados no período"
          description="Nenhum atendimento concluído nesse intervalo."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2">Origem</th>
                <th className="py-2 text-right">Clientes</th>
                <th className="py-2 text-right">Serviços</th>
                <th className="py-2 text-right">Faturamento</th>
                <th className="py-2 text-right">Ticket médio</th>
                <th className="py-2 text-right">% do total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.origin} className="border-t border-border">
                  <td className="py-2">{r.origin}</td>
                  <td className="py-2 text-right">{r.customers}</td>
                  <td className="py-2 text-right">{r.services}</td>
                  <td className="py-2 text-right font-medium">{brl(r.revenue)}</td>
                  <td className="py-2 text-right">{brl(r.ticket)}</td>
                  <td className="py-2 text-right">{r.share.toFixed(1).replace(".", ",")}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card-surface p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
