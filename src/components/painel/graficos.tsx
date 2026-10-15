import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { brl } from "@/lib/format";
import type { ResumoPainel } from "@/lib/painel";

// Uma série só por gráfico (a cor dos dados do tema); o valor exato fica no toque/passar o mouse.
const CONFIG = { valor: { label: "Vendido", color: "var(--color-dado)" } } satisfies ChartConfig;

/** "1,2k" para o eixo (sem centavos). */
function compacto(v: number): string {
  if (v >= 1000) return `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return String(Math.round(v));
}

const plural = (n: number) => (n === 1 ? "1 OS" : `${n} OS`);

export function GraficoVendidoPorSemana({ dados }: { dados: ResumoPainel["vendidoPorSemana"] }) {
  if (dados.every((d) => d.valor === 0)) {
    return <p className="text-sm text-muted-foreground">Nenhuma venda nas últimas 8 semanas.</p>;
  }
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-44 w-full">
      <BarChart data={dados} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} strokeWidth={1} />
        <XAxis dataKey="rotulo" tickLine={false} axisLine={false} tickMargin={6} fontSize={11} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickFormatter={compacto}
          width={36}
          fontSize={11}
        />
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)" }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_rotulo, itens) => {
                const p = itens?.[0]?.payload as { de?: string; ate?: string } | undefined;
                return p?.de ? `Semana de ${p.de.slice(8, 10)}/${p.de.slice(5, 7)}` : "Semana";
              }}
              formatter={(valor, _nome, item) => (
                <span>
                  {brl(Number(valor))} ·{" "}
                  {plural(Number((item.payload as { quantidade?: number }).quantidade ?? 0))}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="valor" fill="var(--color-valor)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ChartContainer>
  );
}

export function GraficoVendasPorOrigem({ dados }: { dados: ResumoPainel["vendidoPorOrigem"] }) {
  // Até 6 origens; o resto vira "Outras" (nunca uma cor nova por origem).
  const principais = dados.slice(0, 6);
  const resto = dados.slice(6);
  const linhas = resto.length
    ? [
        ...principais,
        {
          origem: "Outras",
          valor: Math.round(resto.reduce((t, r) => t + r.valor, 0) * 100) / 100,
          quantidade: resto.reduce((t, r) => t + r.quantidade, 0),
        },
      ]
    : principais;
  if (linhas.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma venda no período.</p>;
  }
  return (
    <ChartContainer
      config={CONFIG}
      className="aspect-auto w-full"
      style={{ height: 30 * linhas.length + 12 }}
    >
      <BarChart
        data={linhas}
        layout="vertical"
        margin={{ top: 4, right: 64, left: 0, bottom: 0 }}
        barCategoryGap="25%"
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="origem"
          tickLine={false}
          axisLine={false}
          width={92}
          fontSize={11}
        />
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)" }}
          content={
            <ChartTooltipContent
              hideIndicator
              formatter={(valor, _nome, item) => (
                <span>
                  {brl(Number(valor))} ·{" "}
                  {plural(Number((item.payload as { quantidade?: number }).quantidade ?? 0))}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="valor" fill="var(--color-valor)" radius={[0, 4, 4, 0]} maxBarSize={20}>
          <LabelList
            dataKey="valor"
            position="right"
            fontSize={11}
            className="fill-foreground"
            formatter={(v: number) => brl(v)}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Leads que chamaram → com orçamento → viraram OS (entrada receptiva do funil). */
export function FunilMini({
  c,
}: {
  c: Pick<ResumoPainel["conversao"], "leads" | "orcamentos" | "os">;
}) {
  const etapas = [
    { rotulo: "Leads que chamaram", n: c.leads },
    { rotulo: "Com orçamento", n: c.orcamentos },
    { rotulo: "Viraram OS", n: c.os },
  ];
  if (c.leads === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum lead chamou no período.</p>;
  }
  return (
    <ol className="flex flex-col gap-2.5" aria-label="Funil de leads">
      {etapas.map((e) => {
        const pct = c.leads > 0 ? (e.n / c.leads) * 100 : 0;
        return (
          <li key={e.rotulo} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2 text-sm">
              <span>{e.rotulo}</span>
              <span className="font-bold tabular-nums">
                {e.n}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {Math.round(pct)}%
                </span>
              </span>
            </span>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full rounded-full bg-dado"
                style={{ width: `${Math.max(pct, e.n > 0 ? 2 : 0)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
