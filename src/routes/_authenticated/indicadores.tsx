import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, MessageSquareText, Target, TrendingUp, UserPlus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageHeader, SectionCard } from "@/components/app-shell";
import { KpiCard } from "@/components/crm-ui";
import { brl, currentMonth, monthEnd, monthStart, pct, todayISO } from "@/lib/format";
import { duracaoMin, taxa, useIndicadores, type Entrada, type Indicadores } from "@/lib/funil";
import { useMinhaEmpresa } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/indicadores")({
  head: () => ({
    meta: [
      { title: "Funil e indicadores — Nexa OS" },
      {
        name: "description",
        content: "Funil de vendas, tempo de resposta, conversão, faturamento e origem dos leads.",
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
  const [entrada, setEntrada] = useState<Entrada>("receptivo");
  const { data, isLoading, error } = useIndicadores(de, ate, empresa?.empresa.id, entrada);

  const presets = [
    { rotulo: "Este mês", de: monthStart(mes), ate: monthEnd(mes) },
    { rotulo: "Mês passado", de: monthStart(mesAnterior(mes)), ate: monthEnd(mesAnterior(mes)) },
    { rotulo: "Últimos 90 dias", de: diasAtras(89), ate: todayISO() },
  ];

  return (
    <>
      <PageHeader
        title="Funil e indicadores"
        description="Leads que chegaram no período e até onde cada um avançou, além dos números de vendas e recebimentos."
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Tipo de lead">
        {(
          [
            [
              "receptivo",
              "Leads novos",
              "o cliente chamou primeiro (Google, orgânico, indicação…)",
            ],
            [
              "ativo",
              "Reativação",
              "vocês chamaram primeiro (retornos de 6 meses / 1 ano, leads antigos)",
            ],
          ] as const
        ).map(([v, rotulo, dica]) => (
          <Button
            key={v}
            role="tab"
            aria-selected={entrada === v}
            variant={entrada === v ? "default" : "outline"}
            title={dica}
            onClick={() => setEntrada(v)}
          >
            {rotulo}
            {data ? (
              <span className="ml-1 tabular-nums opacity-80">({data.entradas[v]})</span>
            ) : null}
          </Button>
        ))}
        <p className="basis-full text-xs text-muted-foreground">
          {entrada === "receptivo"
            ? "Leads novos: quem chamou a empresa primeiro. É aqui que se mede a captação (Google, orgânico etc.)."
            : "Reativação: conversas que a empresa começou (retornos e leads antigos). Não entram nos números de captação."}
        </p>
      </div>

      <div className="card-surface mb-4 flex flex-wrap items-end gap-3 p-4">
        {presets.map((p) => (
          <Button
            key={p.rotulo}
            size="sm"
            variant={p.de === de && p.ate === ate ? "default" : "outline"}
            onClick={() => {
              setDe(p.de);
              setAte(p.ate);
            }}
          >
            {p.rotulo}
          </Button>
        ))}
        <div className="grid gap-1">
          <Label htmlFor="ind-de" className="text-xs">
            De
          </Label>
          <Input
            id="ind-de"
            type="date"
            value={de}
            onChange={(e) => setDe(e.target.value)}
            className="h-9 w-40"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ind-ate" className="text-xs">
            Até
          </Label>
          <Input
            id="ind-ate"
            type="date"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            className="h-9 w-40"
          />
        </div>
      </div>

      {error ? (
        <EmptyState title="Não foi possível carregar os indicadores" />
      ) : isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <Conteudo d={data} />
      )}
    </>
  );
}

function Conteudo({ d }: { d: Indicadores }) {
  const f = d.funil;
  const g = d.periodo_geral;
  const reativacao = d.entrada === "ativo";
  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label={reativacao ? "Clientes chamados" : "Leads novos"}
          value={String(f.leads)}
          hint={`${f.abertos} em aberto`}
          icon={UserPlus}
        />
        {reativacao ? (
          <KpiCard
            label="Responderam"
            value={fmtPct(taxa(f.responderam, f.leads))}
            hint={`${f.responderam} de ${f.leads}`}
            icon={MessageSquareText}
          />
        ) : (
          <KpiCard
            label="Atendidos"
            value={fmtPct(taxa(f.atendidos, f.leads))}
            hint={`${f.atendidos} de ${f.leads}`}
            icon={MessageSquareText}
          />
        )}
        <KpiCard
          label="1ª resposta (mediana)"
          value={duracaoMin(d.atendimento.primeira_resposta_mediana_min)}
          hint={
            d.atendimento.conversas
              ? `${d.atendimento.sem_resposta} conversa(s) sem resposta`
              : "Sem conversas do Chatwoot"
          }
          icon={Clock}
          accent={d.atendimento.sem_resposta > 0 ? "warning" : "teal"}
        />
        <KpiCard
          label="Viraram venda"
          value={fmtPct(taxa(f.os_criada, f.leads))}
          hint={`${f.os_criada} OS de ${f.leads} leads`}
          icon={Target}
          accent="success"
        />
        <KpiCard
          label="Vendido"
          value={brl(d.valores.vendido)}
          hint={`orçado ${brl(d.valores.orcado)}`}
          icon={TrendingUp}
          accent="navy"
        />
        <KpiCard
          label="Recebido"
          value={brl(d.valores.recebido)}
          hint="dos leads do período"
          icon={Wallet}
          accent="navy"
        />
      </div>

      <SectionCard
        title={reativacao ? "Funil da reativação" : "Funil dos leads novos"}
        description={
          reativacao
            ? "Clientes e leads antigos chamados no período e até onde cada um avançou."
            : "Cada barra conta os leads que chegaram a essa etapa (primeiro contato dentro do período, acompanhados até hoje)."
        }
      >
        <Funil d={d} />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <SectionCard
          title="Vendas no período"
          description="Orçamentos criados, OS vendidas e pagamentos recebidos dentro das datas escolhidas, com ou sem lead."
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
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
        </SectionCard>

        <SectionCard
          title={reativacao ? "Quem foi chamado" : "Origem dos leads"}
          description={
            reativacao
              ? "Clientes que já compraram × leads antigos que não fecharam."
              : "De onde vieram os leads novos do período."
          }
        >
          {d.origens.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lead no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">{reativacao ? "Tipo" : "Origem"}</th>
                    <th className="pb-2 text-right font-medium">Leads</th>
                    <th className="pb-2 text-right font-medium">Orçamentos</th>
                    <th className="pb-2 text-right font-medium">Vendas</th>
                    <th className="pb-2 text-right font-medium">Conversão</th>
                    <th className="pb-2 text-right font-medium">Vendido</th>
                  </tr>
                </thead>
                <tbody>
                  {d.origens.map((o) => (
                    <tr key={o.origem} className="border-t border-border">
                      <td className="py-2 text-navy">{o.origem}</td>
                      <td className="py-2 text-right tabular-nums">{o.leads}</td>
                      <td className="py-2 text-right tabular-nums">{o.orcamentos}</td>
                      <td className="py-2 text-right tabular-nums">{o.vendas}</td>
                      <td className="py-2 text-right tabular-nums">
                        {fmtPct(taxa(o.vendas, o.leads))}
                      </td>
                      <td className="py-2 text-right tabular-nums">{brl(o.vendido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="font-semibold text-navy">{valor}</dd>
    </div>
  );
}

/** Barras horizontais: uma série, uma cor; valor escrito na ponta e detalhe ao passar o mouse. */
function Funil({ d }: { d: Indicadores }) {
  const f = d.funil;
  const etapas = [
    ...(d.entrada === "ativo"
      ? [
          { rotulo: "Chamados", n: f.leads },
          { rotulo: "Responderam", n: f.responderam },
        ]
      : [
          { rotulo: "Leads recebidos", n: f.leads },
          { rotulo: "Atendidos", n: f.atendidos },
        ]),
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
              className="group relative grid grid-cols-[8.5rem_1fr] items-center gap-3 rounded-md px-1 py-1.5 hover:bg-secondary/60 sm:grid-cols-[11rem_1fr]"
              aria-label={`${e.rotulo}: ${detalhe}`}
            >
              <span className="truncate text-sm text-navy">{e.rotulo}</span>
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className="h-5 shrink-0 rounded-r bg-chart-2"
                  style={{ width: `calc(${Math.max(doTotal, e.n > 0 ? 1 : 0)}% * 0.8)` }}
                />
                <span className="shrink-0 text-sm tabular-nums text-navy">
                  {e.n}
                  <span className="ml-1 text-xs text-muted-foreground">({pct(doTotal, 0)})</span>
                </span>
              </div>
              <span
                role="tooltip"
                className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-navy px-2 py-1 text-xs text-white shadow group-hover:block"
              >
                {detalhe}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        Perdidos: {f.perdidos} · Em aberto: {f.abertos}. A primeira resposta é medida nas conversas
        que vieram do Chatwoot.
      </p>
    </div>
  );
}
