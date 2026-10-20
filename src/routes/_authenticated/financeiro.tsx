import { mensagemDeErro } from "@/lib/erros";
import { SeletorMes } from "@/components/financeiro/seletor-mes";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { AbasDeRota, CabecalhoDeTela, Card, NumeroGrande } from "@/components/nexa";
import {
  GraficoDespesasPorCategoria,
  GraficoRecebidoDespesas,
} from "@/components/financeiro/graficos";
import { resumoFinanceiro } from "@/lib/financeiro.functions";
import { brl, currentMonth, monthLabelPT } from "@/lib/format";
import { ABAS_DE_TELA, abasPermitidas } from "@/lib/menu";
import { useContextoTenant } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({
    meta: [
      { title: "Financeiro — Nexa OS" },
      {
        name: "description",
        content:
          "Entrou, saiu e saldo do mês, 6 meses, despesas por categoria e os próximos 30 dias.",
      },
      { property: "og:title", content: "Financeiro — Nexa OS" },
      {
        property: "og:description",
        content:
          "Entrou, saiu e saldo do mês, 6 meses, despesas por categoria e os próximos 30 dias.",
      },
    ],
  }),
  component: Financeiro,
});

function Financeiro() {
  const [mes, setMes] = useState(currentMonth());
  const { data: tenant } = useContextoTenant();
  const buscar = useServerFn(resumoFinanceiro);
  const {
    data: r,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["financeiro", mes],
    queryFn: () => buscar({ data: { mes } }),
  });
  const carregando = isLoading && !r;
  const abas = abasPermitidas(
    ABAS_DE_TELA.financeiro,
    tenant?.ativa?.papel ?? null,
    tenant?.souNexa,
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoDeTela titulo="Financeiro" sobretitulo="Resumo" />
      <AbasDeRota abas={abas} rotulo="Financeiro" />
      <SeletorMes mes={mes} onChange={setMes} />
      {error ? (
        <Card className="text-sm text-problema-foreground">
          {mensagemDeErro(error, "Não deu para carregar o financeiro agora.", "financeiro")}
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5">
        <Card className="gap-1 p-3.5">
          <span className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
            Entrou
          </span>
          <span className="font-titulo text-[20px] leading-tight break-words">
            {carregando ? "…" : brl(r?.entrou)}
          </span>
          <span className="text-xs text-muted-foreground">
            {r ? `${r.quantidadeRecebimentos} recebimento(s)` : ""}
          </span>
        </Card>
        <Card className="gap-1 p-3.5">
          <span className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
            Saiu
          </span>
          <span className="font-titulo text-[20px] leading-tight break-words">
            {carregando ? "…" : brl(r?.saiu)}
          </span>
          <span className="text-xs text-muted-foreground">despesas pagas</span>
        </Card>
        <Card
          className={`col-span-2 gap-1 p-3.5 ${r && r.saldo < 0 ? "bg-problema/60" : "bg-marca-claro/40"}`}
        >
          <span className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
            Saldo
          </span>
          <span className="font-titulo text-[20px] leading-tight break-words">
            {carregando ? "…" : brl(r?.saldo)}
          </span>
          <span className="text-xs text-muted-foreground">
            {monthLabelPT(mes).split(" de ")[0]}
          </span>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        Pela data do pagamento (caixa), a mesma competência do DRE.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-label="Recebido e despesas pagas por mês">
          <h2 className="text-sm font-bold">Recebido × despesas pagas (6 meses)</h2>
          {r ? (
            <GraficoRecebidoDespesas dados={r.porMes} />
          ) : (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}
        </Card>
        <Card aria-label="Despesas por categoria">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold">Despesas pagas por categoria</h2>
            <Link
              to="/despesas"
              search={{ aba: undefined }}
              className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-success hover:text-marca"
            >
              Despesas <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
          {r ? (
            <GraficoDespesasPorCategoria dados={r.porCategoria} />
          ) : (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}
        </Card>
      </div>

      <Card aria-label="Próximos 30 dias">
        <h2 className="text-sm font-bold">Próximos 30 dias</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/a-receber"
            search={{ aba: "concluido" }}
            className="rounded-botao hover:bg-muted/60"
          >
            <NumeroGrande
              tamanho="pequeno"
              valor={carregando ? "…" : brl(r?.proximos.aReceber)}
              legenda={`a receber · ${brl(r?.proximos.aReceberConcluidos ?? 0)} de serviços já feitos`}
            />
          </Link>
          <Link
            to="/despesas"
            search={{ aba: "Pendentes" }}
            className="rounded-botao hover:bg-muted/60"
          >
            <NumeroGrande
              tamanho="pequeno"
              valor={carregando ? "…" : brl(r?.proximos.aPagar)}
              legenda={`a pagar · ${brl(r?.proximos.aPagarVencidas ?? 0)} já vencido`}
            />
          </Link>
        </div>
        {r ? (
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            {(() => {
              const total = r.proximos.aReceber + r.proximos.aPagar;
              const pct = total > 0 ? (r.proximos.aReceber / total) * 100 : 0;
              return (
                <>
                  <div className="h-full bg-dado" style={{ width: `${pct}%` }} />
                  <div className="h-full bg-marca" style={{ width: `${100 - pct}%` }} />
                </>
              );
            })()}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
