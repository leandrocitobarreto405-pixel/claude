import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CabecalhoDeTela, Card, Chip, NumeroGrande } from "@/components/nexa";
import { supabase } from "@/integrations/supabase/client";
import { brl, currentMonth, monthEnd, monthLabelPT, monthStart, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/operacao")({
  head: () => ({
    meta: [
      { title: "Operação — Nexa OS" },
      {
        name: "description",
        content: "Despesas vencidas, rotas pendentes e quilometragem do mês.",
      },
      { property: "og:title", content: "Operação — Nexa OS" },
      {
        property: "og:description",
        content: "Despesas vencidas, rotas pendentes e quilometragem do mês.",
      },
    ],
  }),
  component: Operacao,
});

const ROTAS_PENDENTES = [
  "Aguardando conclusão dos serviços",
  "Aguardando custo por km",
  "Erro no cálculo",
];

function useOperacao(mes: string) {
  const de = monthStart(mes);
  const ate = monthEnd(mes);
  const hoje = todayISO();
  return useQuery({
    queryKey: ["operacao", mes],
    queryFn: async () => {
      const contar = (q: PromiseLike<{ count: number | null; error: unknown }>) =>
        q.then((r) => {
          if (r.error) throw r.error;
          return r.count ?? 0;
        });
      const [vencidas, pendentesMes, rotasPend, rotasDif, rotas] = await Promise.all([
        contar(
          supabase
            .from("expenses")
            .select("id", { count: "exact", head: true })
            .lt("due_date", hoje)
            .in("status", ["Pendente", "Parcialmente pago", "Vencido"])
            .is("deleted_at", null),
        ),
        contar(
          supabase
            .from("expenses")
            .select("id", { count: "exact", head: true })
            .gte("competence_date", de)
            .lte("competence_date", ate)
            .in("status", ["Pendente", "Parcialmente pago", "Vencido"])
            .is("deleted_at", null),
        ),
        contar(
          supabase
            .from("daily_routes")
            .select("id", { count: "exact", head: true })
            .in("route_status", ROTAS_PENDENTES),
        ),
        contar(
          supabase
            .from("daily_routes")
            .select("id", { count: "exact", head: true })
            .eq("financial_difference", true),
        ),
        supabase
          .from("daily_routes")
          .select("real_km, calculated_km, total_cost, cost_per_km, route_status")
          .gte("route_date", de)
          .lte("route_date", ate),
      ]);
      if (rotas.error) throw rotas.error;
      const linhas = rotas.data ?? [];
      const km = linhas.reduce((t, r) => t + Number(r.real_km ?? r.calculated_km ?? 0), 0);
      const custo = linhas.reduce((t, r) => t + Number(r.total_cost ?? 0), 0);
      const semCustoKm = linhas.some((r) => r.cost_per_km === null || Number(r.cost_per_km) === 0);
      return {
        vencidas,
        pendentesMes,
        rotasPend,
        rotasDif,
        rotas: linhas.length,
        km,
        custo,
        semCustoKm,
      };
    },
  });
}

function Operacao() {
  const [mes, setMes] = useState(currentMonth());
  const { data: d, isLoading, error } = useOperacao(mes);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Operação"
        descricao="Despesas, rotas e quilometragem: o que precisa de atenção."
        voltarPara="/inicio"
      />
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="mes">Mês</Label>
          <Input
            id="mes"
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="w-[170px]"
          />
        </div>
      </div>
      {error ? (
        <Card className="text-sm text-problema-foreground">{(error as Error).message}</Card>
      ) : null}

      <Card aria-label="Despesas">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Despesas</h2>
          <Link
            to="/despesas"
            search={{ aba: "Vencidas" }}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-success hover:text-marca"
          >
            Abrir <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumeroGrande
            tamanho="pequeno"
            valor={isLoading ? "…" : String(d?.vencidas ?? 0)}
            legenda="vencidas"
          />
          <NumeroGrande
            tamanho="pequeno"
            valor={isLoading ? "…" : String(d?.pendentesMes ?? 0)}
            legenda={`pendentes em ${monthLabelPT(mes).split(" de ")[0]}`}
          />
        </div>
        {(d?.vencidas ?? 0) > 0 ? (
          <Chip tom="atencao" className="self-start">
            Há despesas vencidas
          </Chip>
        ) : null}
      </Card>

      <Card aria-label="Rotas e quilometragem">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Rotas e km</h2>
          <Link
            to="/rotas"
            search={{ dia: undefined }}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-success hover:text-marca"
          >
            Abrir <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumeroGrande
            tamanho="pequeno"
            valor={isLoading ? "…" : `${Math.round(d?.km ?? 0)} km`}
            legenda={`em ${d?.rotas ?? 0} rota(s) no mês`}
          />
          <NumeroGrande
            tamanho="pequeno"
            valor={isLoading ? "…" : brl(d?.custo ?? 0)}
            legenda="custo das rotas do mês"
          />
        </div>
        <ul className="flex flex-wrap gap-2">
          {(d?.rotasPend ?? 0) > 0 ? (
            <li>
              <Chip tom="atencao">{d!.rotasPend} pendente(s) de cálculo</Chip>
            </li>
          ) : null}
          {(d?.rotasDif ?? 0) > 0 ? (
            <li>
              <Chip tom="atencao">{d!.rotasDif} alterada(s) após o pagamento</Chip>
            </li>
          ) : null}
          {d?.semCustoKm ? (
            <li>
              <Chip tom="problema">Rota sem custo por km</Chip>
            </li>
          ) : null}
          {d && d.rotasPend === 0 && d.rotasDif === 0 && !d.semCustoKm ? (
            <li>
              <Chip tom="sucesso">Tudo calculado</Chip>
            </li>
          ) : null}
        </ul>
        <p className="text-xs text-muted-foreground">
          O custo por km fica em Configurações › Empresa; o fechamento da quilometragem roda todo
          dia 1º.
        </p>
      </Card>
    </div>
  );
}
