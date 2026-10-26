// Indicadores › Vendas da Nexa x da empresa (decisão E), pela data da venda. Só aparece quando a
// empresa tem venda da equipe Nexa (atendente da Nexa ou Alice) no período.
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/nexa";
import { supabase } from "@/integrations/supabase/client";
import { brl, pct } from "@/lib/format";
import { resumoPorEquipe, type OsDoResumo } from "@/lib/vendido-por";

export function VendasPorEquipe({ de, ate }: { de: string; ate: string }) {
  const { data } = useQuery({
    queryKey: ["vendas-por-equipe", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select(
          "total_gross_value, status, cancelled_at, deleted_at, eh_teste, vendido_por, vendedora:salesperson_id ( atendente_nexa )",
        )
        .gte("sale_date", de)
        .lte("sale_date", ate)
        .limit(5000);
      if (error) throw error;
      return resumoPorEquipe((data ?? []) as unknown as OsDoResumo[]);
    },
  });
  if (!data || data.nexa.os === 0) return null;
  const total = data.nexa.valor + data.empresa.valor;
  const linhas = [
    { rotulo: "Vendas da Nexa", ...data.nexa },
    { rotulo: "Da empresa", ...data.empresa },
  ];
  return (
    <Card>
      <h2 className="text-sm font-bold">Quem vendeu (pela data da venda)</h2>
      <ul className="grid gap-2">
        {linhas.map((l) => (
          <li key={l.rotulo} className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-semibold">{l.rotulo}</span>
              <span className="text-xs text-muted-foreground">{l.os} OS</span>
            </span>
            <span className="text-right">
              <span className="block font-bold tabular-nums">{brl(l.valor)}</span>
              <span className="text-xs text-muted-foreground">
                {total > 0 ? pct((l.valor / total) * 100) : "—"} do vendido
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Nexa = atendente da Nexa ou Alice. OS de teste, canceladas e apagadas não contam.
      </p>
    </Card>
  );
}
