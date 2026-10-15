import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { brl } from "@/lib/format";

// Duas séries: recebido (cor dos dados) e despesas pagas (verde-escuro da marca). Tons da mesma
// família com luminosidade bem diferente: dá para separar até em preto e branco; a legenda e o
// toque trazem o nome e o valor.
const CONFIG_MESES = {
  recebido: { label: "Recebido", color: "var(--color-dado)" },
  pago: { label: "Despesas pagas", color: "var(--color-marca)" },
} satisfies ChartConfig;

const CONFIG_CAT = { valor: { label: "Pago", color: "var(--color-dado)" } } satisfies ChartConfig;

function compacto(v: number): string {
  if (v >= 1000) return `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return String(Math.round(v));
}

export function GraficoRecebidoDespesas({
  dados,
}: {
  dados: { rotulo: string; recebido: number; pago: number }[];
}) {
  if (dados.every((d) => d.recebido === 0 && d.pago === 0)) {
    return (
      <p className="text-sm text-muted-foreground">Nada recebido nem pago nos últimos 6 meses.</p>
    );
  }
  return (
    <ChartContainer config={CONFIG_MESES} className="aspect-auto h-52 w-full">
      <BarChart
        data={dados}
        margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
        barCategoryGap="25%"
        barGap={2}
      >
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
              formatter={(v, nome) => (
                <span>
                  {nome === "recebido" ? "Recebido" : "Despesas pagas"}: {brl(Number(v))}
                </span>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="recebido"
          fill="var(--color-recebido)"
          radius={[4, 4, 0, 0]}
          maxBarSize={20}
        />
        <Bar dataKey="pago" fill="var(--color-pago)" radius={[4, 4, 0, 0]} maxBarSize={20} />
      </BarChart>
    </ChartContainer>
  );
}

export function GraficoDespesasPorCategoria({
  dados,
}: {
  dados: { categoria: string; valor: number }[];
}) {
  const principais = dados.slice(0, 7);
  const resto = dados.slice(7);
  const linhas = resto.length
    ? [
        ...principais,
        {
          categoria: "Outras",
          valor: Math.round(resto.reduce((t, r) => t + r.valor, 0) * 100) / 100,
        },
      ]
    : principais;
  if (linhas.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhuma despesa paga no mês.</p>;
  return (
    <ChartContainer
      config={CONFIG_CAT}
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
          dataKey="categoria"
          tickLine={false}
          axisLine={false}
          width={104}
          fontSize={11}
        />
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)" }}
          content={
            <ChartTooltipContent hideIndicator formatter={(v) => <span>{brl(Number(v))}</span>} />
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
