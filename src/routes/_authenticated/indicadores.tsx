import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/app-shell";
import { VisaoGeralCrm } from "@/components/crm/visao-geral";
import { DeteccaoDaOrigem } from "@/components/origem/deteccao-origem";
import { AbasDeRota, CabecalhoDeTela, Card, Recolhido } from "@/components/nexa";
import { CartaoNumero } from "@/components/painel/cartao-numero";
import { FunilMini, GraficoVendasPorOrigem } from "@/components/painel/graficos";
import { ABAS_DE_TELA } from "@/lib/menu";
import { brl, currentMonth, monthEnd, monthStart, pct, todayISO } from "@/lib/format";
import { duracaoMin, taxa, useIndicadores, type Indicadores } from "@/lib/funil";
import { useMinhaEmpresa } from "@/lib/tenant";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/indicadores")({
  head: () => ({
    meta: [
      { title: "Leads e funil: indicadores — Nexa OS" },
      {
        name: "description",
        content: "Conversão dos leads que chamaram, tempo da 1ª resposta e vendas por origem.",
      },
    ],
  }),
  component: IndicadoresPage,
});

function mesAnterior(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return d.toISOString().slice(0, 7);
}

function diasAtras(n: number) {
  const d = new Date(`${todayISO()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const fmtPct = (v: number | null) => (v === null ? "—" : pct(v));

function IndicadoresPage() {
  const mes = currentMonth();
  const [de, setDe] = useState(monthStart(mes));
  const [ate, setAte] = useState(monthEnd(mes));
  const { data: empresa } = useMinhaEmpresa();
  // Só os leads que chamaram (entrada receptiva): é aí que se mede a captação.
  const { data, isLoading, error } = useIndicadores(de, ate, empresa?.empresa.id, "receptivo");

  const presets = [
    { rotulo: "Este mês", de: monthStart(mes), ate: monthEnd(mes) },
    { rotulo: "Mês passado", de: monthStart(mesAnterior(mes)), ate: monthEnd(mesAnterior(mes)) },
    { rotulo: "90 dias", de: diasAtras(89), ate: todayISO() },
  ];
  const presetAtivo = presets.some((p) => p.de === de && p.ate === ate);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoDeTela titulo="Leads e funil" sobretitulo="Indicadores" />
      <AbasDeRota abas={ABAS_DE_TELA.leads} rotulo="Leads e funil" />

      <div
        role="group"
        aria-label="Período"
        className="grid grid-cols-3 gap-1 rounded-botao bg-muted p-1"
      >
        {presets.map((p) => {
          const ativo = p.de === de && p.ate === ate;
          return (
            <button
              key={p.rotulo}
              type="button"
              aria-pressed={ativo}
              onClick={() => {
                setDe(p.de);
                setAte(p.ate);
              }}
              className={cn(
                "min-h-11 rounded-botao text-sm transition-colors",
                ativo
                  ? "bg-card font-bold text-foreground shadow-card"
                  : "font-medium text-muted-foreground",
              )}
            >
              {p.rotulo}
            </button>
          );
        })}
      </div>
      <Recolhido titulo="Outro período" abertoInicial={!presetAtivo}>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="grid gap-1">
            <Label htmlFor="ind-de">De</Label>
            <Input
              id="ind-de"
              type="date"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ind-ate">Até</Label>
            <Input
              id="ind-ate"
              type="date"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
      </Recolhido>

      {error ? (
        <EmptyState title="Não foi possível carregar os indicadores" />
      ) : isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <Conteudo d={data} />
      )}
      <DeteccaoDaOrigem de={de} ate={ate} />
      <VisaoGeralCrm />
    </div>
  );
}

function Conteudo({ d }: { d: Indicadores }) {
  const f = d.funil;
  const g = d.periodo_geral;
  const porOrigem = d.origens
    .filter((o) => o.vendas > 0)
    .map((o) => ({ origem: o.origem, valor: o.vendido, quantidade: o.vendas }))
    .sort((a, b) => b.valor - a.valor);
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <CartaoNumero
          titulo="Leads que chamaram"
          valor={String(f.leads)}
          detalhe={`${f.abertos} em aberto · ${f.perdidos} perdido(s)`}
        />
        <CartaoNumero
          titulo="Viraram OS"
          valor={fmtPct(taxa(f.os_criada, f.leads))}
          detalhe={`${f.os_criada} OS de ${f.leads} leads`}
          destaque
        />
        <CartaoNumero
          titulo="1ª resposta"
          valor={duracaoMin(d.atendimento.primeira_resposta_mediana_min)}
          detalhe={
            d.atendimento.conversas
              ? `mediana · ${d.atendimento.sem_resposta} sem resposta`
              : "sem conversas do WhatsApp"
          }
        />
        <CartaoNumero
          titulo="Vendido (pela data da venda)"
          valor={brl(d.valores.vendido)}
          detalhe={`orçado ${brl(d.valores.orcado)} · recebido ${brl(d.valores.recebido)}`}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Leads cujo primeiro contato foi no período (quem chamou a empresa), acompanhados até hoje.
        OS de teste não contam.
      </p>

      <Card>
        <h2 className="text-sm font-bold">Funil</h2>
        <FunilMini c={{ leads: f.leads, orcamentos: f.orcamento, os: f.os_criada }} />
      </Card>

      <Card>
        <h2 className="text-sm font-bold">Vendas por origem (pela data da venda)</h2>
        <GraficoVendasPorOrigem dados={porOrigem} />
      </Card>

      <Recolhido titulo="Leads por origem">
        {d.origens.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nenhum lead no período.</p>
        ) : (
          <ul className="divide-y divide-border">
            {d.origens.map((o) => (
              <li
                key={o.origem}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{o.origem}</span>
                  <span className="text-xs text-muted-foreground">
                    {o.leads} lead(s) · {o.orcamentos} orçamento(s) · {o.vendas} venda(s)
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-bold tabular-nums">
                    {fmtPct(taxa(o.vendas, o.leads))}
                  </span>
                  <span className="text-xs text-muted-foreground">{brl(o.vendido)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Recolhido>

      <Recolhido titulo="Funil completo">
        <div className="p-4">
          <Funil d={d} />
        </div>
      </Recolhido>

      <Recolhido titulo="Vendas no período, pela data da venda (com ou sem lead)">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm">
          <Numero rotulo="Orçamentos criados" valor={String(g.orcamentos)} />
          <Numero
            rotulo="Aprovados"
            valor={`${g.orcamentos_aprovados} (${fmtPct(taxa(g.orcamentos_aprovados, g.orcamentos))})`}
          />
          <Numero rotulo="Valor aprovado" valor={brl(g.valor_aprovado)} />
          <Numero
            rotulo="Lucro médio dos aprovados"
            valor={g.lucro_medio_aprovado_pct === null ? "—" : pct(g.lucro_medio_aprovado_pct)}
          />
          <Numero rotulo="OS vendidas" valor={String(g.os)} />
          <Numero rotulo="Valor vendido" valor={brl(g.vendido)} />
          <Numero
            rotulo="Ticket médio"
            valor={g.ticket_medio === null ? "—" : brl(g.ticket_medio)}
          />
          <Numero rotulo="Recebido (bruto)" valor={brl(g.recebido)} />
          <Numero rotulo="Recebido (líquido de taxas)" valor={brl(g.recebido_liquido)} />
          <Numero rotulo="Orçamentos recusados" valor={String(g.orcamentos_recusados)} />
        </dl>
      </Recolhido>
    </>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="font-semibold">{valor}</dd>
    </div>
  );
}

/** Todas as etapas, do lead recebido ao pagamento; uma cor só, valor na ponta. */
function Funil({ d }: { d: Indicadores }) {
  const f = d.funil;
  const etapas = [
    { rotulo: "Leads recebidos", n: f.leads },
    { rotulo: "Atendidos", n: f.atendidos },
    { rotulo: "Com orçamento", n: f.orcamento },
    { rotulo: "Orçamento enviado", n: f.orcamento_enviado },
    { rotulo: "Orçamento aprovado", n: f.orcamento_aprovado },
    { rotulo: "Viraram OS", n: f.os_criada },
    { rotulo: "Serviço agendado", n: f.agendado },
    { rotulo: "Serviço realizado", n: f.realizado },
    { rotulo: "Pagamento recebido", n: f.faturado },
  ];
  if (f.leads === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nenhum lead com primeiro contato no período.</p>
    );
  }
  return (
    <div className="grid gap-1">
      <ol className="grid gap-1" aria-label="Funil de vendas">
        {etapas.map((e, i) => {
          const doTotal = taxa(e.n, f.leads) ?? 0;
          const anterior = i > 0 ? taxa(e.n, etapas[i - 1]!.n) : null;
          const detalhe = `${e.n} lead(s) · ${pct(doTotal)} do total${
            anterior !== null ? ` · ${pct(anterior)} da etapa anterior` : ""
          }`;
          return (
            <li
              key={e.rotulo}
              className="grid grid-cols-[8.5rem_1fr] items-center gap-3 rounded-md px-1 py-1.5 sm:grid-cols-[11rem_1fr]"
              aria-label={`${e.rotulo}: ${detalhe}`}
              title={detalhe}
            >
              <span className="truncate text-sm">{e.rotulo}</span>
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className="h-4 shrink-0 rounded-r bg-dado"
                  style={{ width: `calc(${Math.max(doTotal, e.n > 0 ? 1 : 0)}% * 0.8)` }}
                />
                <span className="shrink-0 text-sm tabular-nums">
                  {e.n}
                  <span className="ml-1 text-xs text-muted-foreground">({pct(doTotal, 0)})</span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        Perdidos: {f.perdidos} · Em aberto: {f.abertos}. A primeira resposta é medida nas conversas
        que vieram do WhatsApp.
      </p>
    </div>
  );
}
