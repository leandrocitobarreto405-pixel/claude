import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/app-shell";
import { VisaoGeralCrm } from "@/components/crm/visao-geral";
import { RelatorioPerdas } from "@/components/crm/sem-desfecho";
import { DeteccaoDaOrigem } from "@/components/origem/deteccao-origem";
import { CabecalhoDeTela, Card, Recolhido } from "@/components/nexa";
import { CartaoNumero } from "@/components/painel/cartao-numero";
import {
  FunilMini,
  GraficoVendasPorOrigem,
  GraficoVendidoPorSemana,
} from "@/components/painel/graficos";
import { MetaDoMes } from "@/components/painel/meta-do-mes";
import { QuemVendeu } from "@/components/painel/quem-vendeu";
import { desempenhoVendasFn, respostasPeloNexaFn } from "@/lib/desempenho-vendas.functions";
import type { SemanaRespostas } from "@/lib/desempenho-vendas";
import { brl, currentMonth, dateBR, monthEnd, monthStart, pct, todayISO } from "@/lib/format";
import { duracaoMin, taxa, useIndicadores, type Indicadores } from "@/lib/funil";
import { resumoPainel } from "@/lib/painel.functions";
import {
  JANELA_RESPOSTA_HORAS,
  ROTULO_CANCELADO,
  type EtapaFunil,
  type MotivoCancelado,
} from "@/lib/painel-followup";
import { painelFollowupFn } from "@/lib/painel-followup.functions";
import { useMinhaEmpresa, usePapel } from "@/lib/tenant";
import { vendidoDoPeriodoFn } from "@/lib/vendido.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/crm/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard de vendas — Nexa OS" },
      {
        name: "description",
        content:
          "Vendido, ticket, conversão, meta com ritmo, quem vendeu, Alice × equipe, vendido por semana e por origem.",
      },
    ],
  }),
  component: Dashboard,
});

function mesAnterior(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 7);
}

function diasAtras(n: number) {
  const d = new Date(`${todayISO()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const fmtPct = (v: number | null) => (v === null ? "—" : pct(v));
const taxaTexto = (parte: number, total: number) => (total ? pct((parte / total) * 100) : "—");
const MOTIVOS = Object.keys(ROTULO_CANCELADO) as MotivoCancelado[];

function Dashboard() {
  const mes = currentMonth();
  const [de, setDe] = useState(monthStart(mes));
  const [ate, setAte] = useState(monthEnd(mes));
  const { data: empresa } = useMinhaEmpresa();
  const { papel } = usePapel();
  const periodo = { de, ate };
  const esteMes = de === monthStart(mes) && ate === monthEnd(mes);

  // Só os leads que chamaram (entrada receptiva): é aí que se mede a captação.
  const indicadores = useIndicadores(de, ate, empresa?.empresa.id, "receptivo");
  const buscarVendido = useServerFn(vendidoDoPeriodoFn);
  const vendido = useQuery({
    queryKey: ["vendido-do-periodo", de, ate],
    queryFn: () => buscarVendido({ data: { de, ate } }),
  });
  const buscarResumo = useServerFn(resumoPainel);
  const resumo = useQuery({
    queryKey: ["painel", "mes"],
    queryFn: () => buscarResumo({ data: { periodo: "mes" } }),
  });
  const buscarDesempenho = useServerFn(desempenhoVendasFn);
  const desempenho = useQuery({
    queryKey: ["desempenho-vendas", de, ate],
    queryFn: () => buscarDesempenho({ data: { de, ate } }),
  });
  const buscarPeloNexa = useServerFn(respostasPeloNexaFn);
  const peloNexa = useQuery({
    queryKey: ["respostas-pelo-nexa"],
    queryFn: () => buscarPeloNexa(),
  });
  const buscarFollowup = useServerFn(painelFollowupFn);
  const followup = useQuery({
    queryKey: ["painel-followup", de, ate],
    queryFn: () => buscarFollowup({ data: { de, ate } }),
  });

  const presets = [
    { rotulo: "Este mês", de: monthStart(mes), ate: monthEnd(mes) },
    { rotulo: "Mês passado", de: monthStart(mesAnterior(mes)), ate: monthEnd(mesAnterior(mes)) },
    { rotulo: "90 dias", de: diasAtras(89), ate: todayISO() },
  ];
  const presetAtivo = presets.some((p) => p.de === de && p.ate === ate);
  const d = indicadores.data;
  const v = vendido.data;
  const rotuloPeriodo = `${dateBR(de)} a ${dateBR(ate)}`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoDeTela titulo="Dashboard" sobretitulo="Vendas" />

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
            <Label htmlFor="dash-de">De</Label>
            <Input
              id="dash-de"
              type="date"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="dash-ate">Até</Label>
            <Input
              id="dash-ate"
              type="date"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
      </Recolhido>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <CartaoNumero
          titulo="Vendido"
          valor={v ? brl(v.valor) : "…"}
          detalhe={v ? `${v.quantidade} OS · serviços no período` : "carregando"}
          destaque
        />
        <CartaoNumero
          titulo="Ticket médio"
          valor={v ? (v.quantidade ? brl(v.valor / v.quantidade) : "—") : "…"}
          detalhe="Vendido ÷ OS"
        />
        <CartaoNumero
          titulo="Conversão"
          valor={d ? fmtPct(taxa(d.funil.os_criada, d.funil.leads)) : "…"}
          detalhe={d ? `${d.funil.os_criada} OS de ${d.funil.leads} leads` : "carregando"}
        />
        <CartaoNumero
          titulo="1ª resposta"
          valor={d ? duracaoMin(d.atendimento.primeira_resposta_mediana_min) : "…"}
          detalhe={d ? `mediana · ${d.atendimento.sem_resposta} sem resposta` : "carregando"}
        />
      </div>

      {esteMes ? (
        <MetaDoMes r={resumo.data} carregando={resumo.isLoading} podeDefinir={papel === "admin"} />
      ) : null}

      {v ? (
        <QuemVendeu
          linhas={v.quemVendeu}
          rotuloPeriodo={rotuloPeriodo}
          proximosMeses={v.proximosMeses}
          desempenho={desempenho.data ?? null}
        />
      ) : (
        <Card className="min-h-24 animate-pulse" aria-busy />
      )}

      <Card>
        <h2 className="text-sm font-bold">Alice × equipe</h2>
        {followup.data ? (
          <>
            <p className="text-sm text-muted-foreground">
              {followup.data.funil.leadsNovos} leads que chamaram no período;{" "}
              {followup.data.funil.semOrcamento} ainda sem orçamento. Separado por quem fez o
              orçamento.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColunaFunil titulo="Alice" e={followup.data.funil.alice} />
              <ColunaFunil titulo="Equipe" e={followup.data.funil.equipe} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-bold">
          Respostas da equipe feitas pelo Nexa (últimas 8 semanas)
        </h2>
        <p className="text-sm text-muted-foreground">
          Mensagens da equipe ao cliente enviadas pelas Conversas do Nexa, em relação ao total
          (Nexa, Chatwoot e celular). Campanhas do Marketing não contam.
        </p>
        {peloNexa.data ? (
          <RespostasPeloNexa semanas={peloNexa.data} />
        ) : (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-bold">Vendido por semana (serviços, últimas 8 semanas)</h2>
        {resumo.data ? (
          <GraficoVendidoPorSemana dados={resumo.data.vendidoPorSemana} />
        ) : (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-bold">Vendas por origem (serviços no período)</h2>
        <GraficoVendasPorOrigem dados={v?.porOrigem ?? []} />
      </Card>

      <Recolhido titulo="Perdas por motivo">
        <div className="p-2">
          <RelatorioPerdas periodo={periodo} />
        </div>
      </Recolhido>

      <Recolhido titulo="Cadência de follow-up (por toque e por semana)">
        <div className="p-4">
          {followup.data ? (
            <Cadencia dados={followup.data} />
          ) : (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}
        </div>
      </Recolhido>

      <Recolhido titulo="Campanhas e visão geral">
        <div className="p-4">
          <VisaoGeralCrm />
        </div>
      </Recolhido>

      {indicadores.error ? (
        <EmptyState title="Não foi possível carregar os indicadores" />
      ) : d ? (
        <MaisIndicadores d={d} />
      ) : null}

      <DeteccaoDaOrigem de={de} ate={ate} />
    </div>
  );
}

function RespostasPeloNexa({ semanas }: { semanas: SemanaRespostas[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {semanas.map((s) => (
        <li key={s.semana} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-sm">
          <span className="text-muted-foreground">{dateBR(s.semana).slice(0, 5)}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span
              className="block h-full rounded-full bg-marca"
              style={{ width: `${s.pct ?? 0}%` }}
            />
          </span>
          <span className="tabular-nums">
            {s.pct === null ? "—" : `${String(s.pct).replace(".", ",")}%`}{" "}
            <span className="text-xs text-muted-foreground">
              ({s.peloNexa} de {s.total})
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ColunaFunil({ titulo, e }: { titulo: string; e: EtapaFunil }) {
  const linhas: Array<[string, string]> = [
    ["Orçamentos", String(e.orcamentos)],
    ["Agendaram", `${e.agendaram} (${taxaTexto(e.agendaram, e.orcamentos)})`],
    ["Realizados", String(e.realizados)],
    ["Valor agendado", brl(e.valorAgendado)],
  ];
  return (
    <div className="rounded-card border border-border p-3">
      <p className="mb-2 font-bold">{titulo}</p>
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        {linhas.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-semibold tabular-nums">{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Cadencia({ dados }: { dados: Awaited<ReturnType<typeof painelFollowupFn>> }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Respondeu = qualquer mensagem do cliente (texto, áudio, foto, até um “.”) em até{" "}
        {JANELA_RESPOSTA_HORAS} h depois do toque. Virou OS = OS criada depois do toque.
      </p>
      {!dados.toques.length ? (
        <p className="text-sm text-muted-foreground">Nenhum toque no período.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Toque</th>
                <th className="py-2 pr-3 text-right">Enviados</th>
                <th className="py-2 pr-3 text-right">Responderam</th>
                <th className="py-2 pr-3 text-right">Viraram OS</th>
                <th className="py-2 pr-3">Não saíram (por quê)</th>
                <th className="py-2 text-right">Na fila</th>
              </tr>
            </thead>
            <tbody>
              {dados.toques.map((t) => (
                <tr key={t.toque} className="border-t border-border align-top">
                  <td className="py-2 pr-3 font-bold">
                    {t.toque === "R" ? "R (retomada)" : t.toque}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{t.enviados}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {t.responderam}{" "}
                    <span className="text-muted-foreground">
                      ({taxaTexto(t.responderam, t.enviados)})
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{t.viraramOs}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {MOTIVOS.filter((m) => t.cancelados[m])
                      .map((m) => `${ROTULO_CANCELADO[m]}: ${t.cancelados[m]}`)
                      .join(" · ") || "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">{t.pendentes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dados.semanas.length ? (
        <ul className="flex flex-col divide-y divide-border">
          {dados.semanas.map((s) => (
            <li
              key={s.semana}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span className="font-semibold">Semana de {dateBR(s.semana)}</span>
              <span className="tabular-nums text-muted-foreground">
                {s.enviados} enviados · {s.responderam} responderam (
                {taxaTexto(s.responderam, s.enviados)}) · {s.viraramOs}{" "}
                {s.viraramOs === 1 ? "virou" : "viraram"} OS
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MaisIndicadores({ d }: { d: Indicadores }) {
  const f = d.funil;
  const g = d.periodo_geral;
  return (
    <>
      <Recolhido titulo="Funil completo">
        <div className="flex flex-col gap-3 p-4">
          <FunilMini c={{ leads: f.leads, orcamentos: f.orcamento, os: f.os_criada }} />
          <Funil d={d} />
        </div>
      </Recolhido>

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

      <Recolhido titulo="Fechado no período, pela data da venda (com ou sem lead)">
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
