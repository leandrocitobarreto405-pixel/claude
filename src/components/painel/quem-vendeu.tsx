// "Quem vendeu" (28/10): por vendedora (Maria, Carol, Alice…), pela data do serviço — a mesma base
// do Vendido, então a soma bate com ele. O fechado agora para meses seguintes vem à parte.
import { Card } from "@/components/nexa";
import { brl, pct } from "@/lib/format";

export function QuemVendeu({
  linhas,
  rotuloPeriodo,
  proximosMeses,
}: {
  linhas: { vendedora: string; valor: number; quantidade: number }[];
  rotuloPeriodo: string;
  proximosMeses?: { valor: number; quantidade: number } | null;
}) {
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  return (
    <Card>
      <h2 className="text-sm font-bold">Quem vendeu · {rotuloPeriodo}</h2>
      {linhas.length ? (
        <ul className="grid gap-2">
          {linhas.map((l) => (
            <li key={l.vendedora} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="block font-semibold">{l.vendedora}</span>
                <span className="text-xs text-muted-foreground">{l.quantidade} OS</span>
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
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum serviço no período.</p>
      )}
      <p className="text-xs text-muted-foreground">
        Serviços com data no período (a mesma conta do Vendido). OS de teste, canceladas e apagadas
        não contam.
      </p>
      {proximosMeses && proximosMeses.quantidade > 0 ? (
        <p className="rounded-botao bg-marca-claro px-3 py-2 text-sm text-marca">
          Já vendido para os próximos meses: <strong>{brl(proximosMeses.valor)}</strong> (
          {proximosMeses.quantidade} OS) — projeção, fora do Vendido.
        </p>
      ) : null}
    </Card>
  );
}
