import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AbasDeRota, Botao, CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { CompletionDialog, VisitDialog } from "@/components/visit-dialog";
import { PaymentDialog } from "@/components/payment-dialog";
import { supabase } from "@/integrations/supabase/client";
import { VISIT_SELECT, type VisitRow } from "@/lib/os";
import { semOsDeTeste } from "@/lib/os-teste";
import { useTechnicians } from "@/lib/data";
import { usePapel } from "@/lib/tenant";
import { useSession } from "@/lib/session";
import { filtroDeTecnico, mostraValores, rotuloDoTecnico, tecnicoDoLogin } from "@/lib/meu-tecnico";
import { useReceivables } from "@/lib/receivables";
import { ABAS_DE_TELA } from "@/lib/menu";
import {
  agruparPorDia,
  diasDeAtraso,
  etiquetaPagamento,
  ordenarParaConcluir,
  textoAtraso,
} from "@/lib/servicos";
import {
  brl,
  currentMonth,
  dateBR,
  monthEnd,
  monthLabelPT,
  monthStart,
  timeBR,
  todayISO,
  weekdayPT,
} from "@/lib/format";
import { cn } from "@/lib/utils";

type Aba = "para-concluir" | "realizados";

export const Route = createFileRoute("/_authenticated/servicos")({
  // `?aba=para-concluir` (atrasados e de hoje) ou `realizados`.
  validateSearch: (s: Record<string, unknown>): { aba?: Aba } =>
    s["aba"] === "para-concluir" || s["aba"] === "realizados" ? { aba: s["aba"] } : {},
  head: () => ({
    meta: [
      { title: "Agenda: serviços — Nexa OS" },
      {
        name: "description",
        content:
          "Serviços para concluir (atrasados e de hoje) e realizados, com pago ou a receber.",
      },
      { property: "og:title", content: "Agenda: serviços — Nexa OS" },
      {
        property: "og:description",
        content:
          "Serviços para concluir (atrasados e de hoje) e realizados, com pago ou a receber.",
      },
    ],
  }),
  component: Servicos,
});

function Servicos() {
  const navigate = useNavigate();
  const { aba: abaInicial } = Route.useSearch();
  const hoje = todayISO();
  const [aba, setAba] = useState<Aba>(abaInicial ?? "para-concluir");
  const [mes, setMes] = useState(currentMonth());
  const [tecnico, setTecnico] = useState("todos");
  const [busca, setBusca] = useState("");
  const [concluindo, setConcluindo] = useState<VisitRow | null>(null);
  const [detalhes, setDetalhes] = useState<VisitRow | null>(null);
  const [recebendo, setRecebendo] = useState<{ visita: VisitRow; saldo: number } | null>(null);
  const { data: tecnicos } = useTechnicians(false);
  const { papel } = usePapel();
  const { user } = useSession();
  // Técnico: só os serviços dele, sem valores nem etiqueta de pagamento.
  const meuTecnico = tecnicoDoLogin(tecnicos, user?.id);
  const tecnicoVisto = filtroDeTecnico(papel, meuTecnico?.id ?? null, tecnico);
  const comValores = mostraValores(papel);

  const paraConcluir = useQuery({
    queryKey: ["servicos", "para-concluir", hoje],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .lte("scheduled_date", hoje)
        .neq("status", "Concluído")
        .neq("status", "Cancelado")
        .order("scheduled_date")
        .order("scheduled_time");
      if (error) throw error;
      return ((data ?? []) as unknown as VisitRow[]).filter(
        (v) => v.work_order?.status !== "Cancelada" && semOsDeTeste(v),
      );
    },
  });

  const realizados = useQuery({
    queryKey: ["servicos", "realizados", mes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("status", "Concluído")
        .gte("completion_date", monthStart(mes))
        .lte("completion_date", monthEnd(mes))
        .order("completion_date", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as VisitRow[]).filter(semOsDeTeste);
    },
  });

  // Saldo em aberto por serviço (a mesma conta da tela A receber). O técnico não precisa disso.
  const aReceber = useReceivables();
  const saldoPorVisita = useMemo(() => {
    const mapa = new Map<string, number>();
    if (!comValores) return mapa;
    for (const i of aReceber.data?.items ?? [])
      if (i.kind === "concluido") mapa.set(i.visitId, i.balance);
    return mapa;
  }, [aReceber.data, comValores]);

  const filtrar = (lista: VisitRow[]) => {
    const termo = busca.trim().toLowerCase();
    return lista.filter(
      (v) =>
        (tecnicoVisto === "todos" || v.technician?.id === tecnicoVisto) &&
        (!termo ||
          (v.work_order?.customer?.full_name ?? "").toLowerCase().includes(termo) ||
          (v.work_order?.os_number ?? "").toLowerCase().includes(termo)),
    );
  };
  const listaParaConcluir = useMemo(
    () => ordenarParaConcluir(filtrar(paraConcluir.data ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paraConcluir.data, tecnicoVisto, busca],
  );
  const listaRealizados = useMemo(
    () => filtrar(realizados.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [realizados.data, tecnicoVisto, busca],
  );
  const porDia = useMemo(() => agruparPorDia(listaRealizados), [listaRealizados]);
  const totalRealizado = listaRealizados.reduce(
    (s, v) => s + Number(v.final_value ?? v.visit_value ?? 0),
    0,
  );
  const atrasados = listaParaConcluir.filter(
    (v) => diasDeAtraso(v.scheduled_date, hoje) > 0,
  ).length;

  function recarregar() {
    void paraConcluir.refetch();
    void realizados.refetch();
    void aReceber.refetch();
  }

  function abrirDetalhes(v: VisitRow) {
    // Técnico: tela cheia do serviço (endereço, fotos). Escritório: a janela com reagendar etc.
    if (papel === "tecnico")
      return void navigate({ to: "/servico/$visitId", params: { visitId: v.id } });
    setDetalhes(v);
  }

  const carregando = aba === "para-concluir" ? paraConcluir.isLoading : realizados.isLoading;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela sobretitulo="Serviços" titulo="Agenda" />
      <AbasDeRota abas={ABAS_DE_TELA.agenda} rotulo="Agenda" />

      {papel === "tecnico" && tecnicos && !meuTecnico ? (
        <Card className="text-sm">
          Seu login ainda não está ligado a um cadastro de técnico, por isso a lista está vazia.
          Peça ao administrador para ligar em Configurações › Equipe e acessos.
        </Card>
      ) : null}

      <div
        role="tablist"
        aria-label="Serviços"
        className="grid grid-cols-2 gap-1 rounded-botao bg-muted p-1"
      >
        {(
          [
            { id: "para-concluir", rotulo: "Para concluir", n: listaParaConcluir.length },
            { id: "realizados", rotulo: "Realizados", n: listaRealizados.length },
          ] as const
        ).map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={cn(
              "flex min-h-11 items-center justify-center gap-2 rounded-botao text-sm transition-colors",
              aba === a.id
                ? "bg-card font-bold text-foreground shadow-card"
                : "font-medium text-muted-foreground",
            )}
          >
            {a.rotulo}
            <Chip tom={a.id === "para-concluir" && atrasados > 0 ? "problema" : "neutro"}>
              {a.n}
            </Chip>
          </button>
        ))}
      </div>

      {papel !== "tecnico" && (tecnicos ?? []).length > 1 ? (
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
          role="group"
          aria-label="Técnico"
        >
          {[
            { id: "todos", name: "Todos" },
            ...(meuTecnico ? [meuTecnico] : []),
            ...(tecnicos ?? []).filter((t) => t.id !== meuTecnico?.id),
          ].map((t) => {
            const sel = tecnico === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={sel}
                onClick={() => setTecnico(t.id)}
                className={cn(
                  "min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors",
                  sel
                    ? "border-marca bg-marca text-marca-foreground"
                    : "border-border bg-card text-foreground hover:border-marca/40",
                )}
              >
                {rotuloDoTecnico(t.name, t.id, meuTecnico?.id ?? null)}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        {aba === "realizados" ? (
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
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="busca">Buscar cliente ou OS</Label>
          <Input id="busca" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : aba === "para-concluir" ? (
        listaParaConcluir.length === 0 ? (
          <Card className="items-center py-8 text-center">
            <CheckCircle2 className="size-8 text-success" aria-hidden />
            <p className="text-[15px] font-bold">Nada para concluir</p>
            <p className="text-sm text-muted-foreground">
              Nenhum serviço atrasado nem de hoje em aberto.
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2.5" aria-label="Serviços para concluir">
            {listaParaConcluir.map((v) => {
              const atraso = textoAtraso(diasDeAtraso(v.scheduled_date, hoje));
              return (
                <Card as="li" key={v.id} className="gap-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-xs font-bold text-muted-foreground">
                        {atraso.tom === "neutro"
                          ? "Hoje"
                          : `${weekdayPT(v.scheduled_date)}, ${dateBR(v.scheduled_date)}`}
                        {" · "}
                        {timeBR(v.scheduled_time)}
                      </span>
                      <span className="truncate text-[15px] font-bold leading-snug">
                        {v.work_order?.customer?.full_name ?? "Cliente"}
                      </span>
                      <span className="text-[13px] text-muted-foreground">
                        {[
                          v.service_type?.name,
                          v.upholstery_description || v.upholstery_type?.name,
                          v.work_order?.os_number ? `OS ${v.work_order.os_number}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="text-[13px] text-muted-foreground">
                        {[
                          v.technician?.name ?? "Sem técnico",
                          comValores ? brl(v.final_value ?? v.visit_value) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <Chip tom={atraso.tom} className="shrink-0">
                      {atraso.rotulo}
                    </Chip>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Botao variante="neutro" onClick={() => abrirDetalhes(v)}>
                      Detalhes
                    </Botao>
                    <Botao onClick={() => setConcluindo(v)}>Concluir</Botao>
                  </div>
                </Card>
              );
            })}
          </ul>
        )
      ) : listaRealizados.length === 0 ? (
        <Card className="items-center py-8 text-center">
          <p className="text-[15px] font-bold">Nenhum serviço concluído</p>
          <p className="text-sm text-muted-foreground">
            {monthLabelPT(mes)}. Ajuste o mês ou os filtros.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">
            {listaRealizados.length} serviço(s) em {monthLabelPT(mes)}
            {comValores ? ` · ${brl(totalRealizado)}` : ""}
          </p>
          {porDia.map(([dia, lista]) => (
            <section key={dia} className="flex flex-col gap-2.5">
              <h2 className="flex items-baseline justify-between gap-2">
                <span className="font-titulo text-lg capitalize">
                  {dia ? `${weekdayPT(dia)}, ${dateBR(dia)}` : "Sem data"}
                </span>
                <span className="text-sm text-muted-foreground">{lista.length}</span>
              </h2>
              <ul className="flex flex-col gap-2.5">
                {lista.map((v) => {
                  const etiqueta = etiquetaPagamento(saldoPorVisita.get(v.id));
                  return (
                    <Card as="li" key={v.id} className="gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => abrirDetalhes(v)}
                          className="flex min-h-11 min-w-0 flex-1 flex-col gap-0.5 text-left"
                        >
                          <span className="text-xs font-bold text-muted-foreground">
                            {timeBR(v.completion_time ?? v.scheduled_time)}
                            {v.work_order?.os_number ? ` · OS ${v.work_order.os_number}` : ""}
                          </span>
                          <span className="truncate text-[15px] font-bold leading-snug">
                            {v.work_order?.customer?.full_name ?? "Cliente"}
                          </span>
                          <span className="text-[13px] text-muted-foreground">
                            {[
                              v.service_type?.name,
                              v.upholstery_description || v.upholstery_type?.name,
                              v.technician?.name,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </button>
                        {comValores ? (
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span className="font-titulo text-[17px] leading-none">
                              {brl(v.final_value ?? v.visit_value)}
                            </span>
                            {etiqueta.saldo > 0 ? (
                              <button
                                type="button"
                                onClick={() => setRecebendo({ visita: v, saldo: etiqueta.saldo })}
                                className="min-h-11 rounded-botao"
                                aria-label={`${etiqueta.rotulo}: registrar recebimento`}
                              >
                                <Chip tom={etiqueta.tom}>{etiqueta.rotulo}</Chip>
                              </button>
                            ) : (
                              <Chip tom={etiqueta.tom}>{etiqueta.rotulo}</Chip>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </Card>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {concluindo ? (
        <CompletionDialog
          visit={concluindo}
          open
          onOpenChange={(v) => !v && setConcluindo(null)}
          onDone={() => {
            setConcluindo(null);
            recarregar();
          }}
        />
      ) : null}
      <VisitDialog
        visit={detalhes}
        open={!!detalhes}
        onOpenChange={(v) => !v && setDetalhes(null)}
        onChanged={recarregar}
      />
      <PaymentDialog
        open={recebendo !== null}
        onOpenChange={(v) => !v && setRecebendo(null)}
        payment={null}
        mode="criar"
        workOrderId={recebendo?.visita.work_order?.id ?? null}
        visitOptions={
          recebendo
            ? [
                {
                  id: recebendo.visita.id,
                  label:
                    [recebendo.visita.service_type?.name, recebendo.visita.upholstery_description]
                      .filter(Boolean)
                      .join(" — ") || "Atendimento",
                },
              ]
            : []
        }
        suggestedAmount={recebendo?.saldo ?? 0}
        osLabel={
          recebendo
            ? `OS ${recebendo.visita.work_order?.os_number ?? ""} · ${recebendo.visita.work_order?.customer?.full_name ?? ""}`
            : ""
        }
        onDone={recarregar}
      />
    </div>
  );
}
