import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { AbasDeRota, Card } from "@/components/nexa";
import { brl, dateBR, pct, todayISO } from "@/lib/format";
import { mensagemDeErro } from "@/lib/erros";
import { ABAS_DE_TELA } from "@/lib/menu";
import {
  JANELA_RESPOSTA_HORAS,
  ROTULO_CANCELADO,
  type EtapaFunil,
  type MotivoCancelado,
} from "@/lib/painel-followup";
import { painelFollowupFn } from "@/lib/painel-followup.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/crm/follow-up")({
  head: () => ({
    meta: [
      { title: "Follow-up — Nexa OS" },
      {
        name: "description",
        content: "O que cada toque da cadência fez, por semana, e o funil Alice × equipe.",
      },
    ],
  }),
  component: PainelFollowup,
});

function diasAtras(n: number) {
  const d = new Date(`${todayISO()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const taxa = (parte: number, total: number) => (total ? pct((parte / total) * 100) : "—");
const MOTIVOS = Object.keys(ROTULO_CANCELADO) as MotivoCancelado[];

function PainelFollowup() {
  const hoje = todayISO();
  const presets = [
    { rotulo: "7 dias", de: diasAtras(6) },
    { rotulo: "4 semanas", de: diasAtras(27) },
    { rotulo: "90 dias", de: diasAtras(89) },
  ];
  const [de, setDe] = useState(presets[1]!.de);
  const buscar = useServerFn(painelFollowupFn);
  const { data, isLoading, error } = useQuery({
    queryKey: ["painel-followup", de, hoje],
    queryFn: () => buscar({ data: { de, ate: hoje } }),
  });

  return (
    <>
      <PageHeader
        title="Leads e funil"
        description="O que cada toque da cadência fez e quem fecha mais: a Alice ou a equipe."
      />
      <AbasDeRota abas={ABAS_DE_TELA.leads} rotulo="Leads e funil" className="mb-4" />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Período">
        {presets.map((p) => (
          <button
            key={p.rotulo}
            type="button"
            aria-pressed={de === p.de}
            onClick={() => setDe(p.de)}
            className={cn(
              "min-h-11 rounded-botao px-4 text-sm font-semibold",
              de === p.de ? "bg-marca text-marca-foreground" : "bg-muted text-foreground",
            )}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {error ? (
        <Card className="text-sm text-problema-foreground">
          {mensagemDeErro(error, "Não deu para carregar o painel.", "followup")}
        </Card>
      ) : isLoading || !data ? (
        <Card className="min-h-40 animate-pulse" aria-busy />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="text-base font-bold">Funil Alice × equipe</h2>
            <p className="text-sm text-muted-foreground">
              {data.funil.leadsNovos} leads que chamaram desde {dateBR(de)};{" "}
              {data.funil.semOrcamento} ainda sem orçamento. Separado por quem fez o orçamento.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColunaFunil titulo="Alice" e={data.funil.alice} />
              <ColunaFunil titulo="Equipe" e={data.funil.equipe} />
            </div>
          </Card>

          <Card>
            <h2 className="text-base font-bold">Por toque</h2>
            <p className="text-sm text-muted-foreground">
              Respondeu = qualquer mensagem do cliente (texto, áudio, foto, até um “.”) em até{" "}
              {JANELA_RESPOSTA_HORAS} h depois do toque. Virou OS = OS criada depois do toque.
            </p>
            {!data.toques.length ? (
              <EmptyState
                title="Nenhum toque no período"
                description="A cadência nova começou em 27/10."
              />
            ) : (
              <div className="-mx-[18px] overflow-x-auto px-[18px]">
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
                    {data.toques.map((t) => (
                      <tr key={t.toque} className="border-t border-border align-top">
                        <td className="py-2 pr-3 font-bold">
                          {t.toque === "R" ? "R (retomada)" : t.toque}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{t.enviados}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {t.responderam}{" "}
                          <span className="text-muted-foreground">
                            ({taxa(t.responderam, t.enviados)})
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
          </Card>

          <Card>
            <h2 className="text-base font-bold">Por semana</h2>
            {!data.semanas.length ? (
              <p className="text-sm text-muted-foreground">Nenhum toque enviado no período.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {data.semanas.map((s) => (
                  <li
                    key={s.semana}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="font-semibold">Semana de {dateBR(s.semana)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {s.enviados} enviados · {s.responderam} responderam (
                      {taxa(s.responderam, s.enviados)}) · {s.viraramOs}{" "}
                      {s.viraramOs === 1 ? "virou" : "viraram"} OS
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function ColunaFunil({ titulo, e }: { titulo: string; e: EtapaFunil }) {
  const linhas: Array<[string, string]> = [
    ["Orçamentos", String(e.orcamentos)],
    ["Agendaram", `${e.agendaram} (${taxa(e.agendaram, e.orcamentos)})`],
    ["Realizados", String(e.realizados)],
    ["Valor agendado", brl(e.valorAgendado)],
  ];
  return (
    <div className="rounded-card border border-border p-3">
      <p className="mb-2 font-bold">{titulo}</p>
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        {linhas.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
