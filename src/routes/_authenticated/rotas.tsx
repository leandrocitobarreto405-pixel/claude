import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useSetting, useTechnicians } from "@/lib/data";
import {
  calcularRotaDoDia,
  fecharQuilometragemDoMes,
  reprocessarRotasComErro,
  sincronizarRotaDoDia,
} from "@/lib/routes.functions";
import { VISIT_SELECT, type VisitRow } from "@/lib/os";
import { brl, currentMonth, dateBR, mapsLink, parseNumberBR, timeBR, todayISO } from "@/lib/format";


export const Route = createFileRoute("/_authenticated/rotas")({
  validateSearch: (search: Record<string, unknown>) => ({
    dia: typeof search["dia"] === "string" ? (search["dia"] as string).slice(0, 10) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Rotas e quilometragem — Gestão Estofados" },
      { name: "description", content: "Roteiro do dia, quilometragem e custo rateado por serviço." },
      { property: "og:title", content: "Rotas e quilometragem — Gestão Estofados" },
      { property: "og:description", content: "Roteiro do dia, quilometragem e custo rateado por serviço." },
    ],
  }),
  component: Rotas,
});

type RotaAuto = Awaited<ReturnType<typeof calcularRotaDoDia>>;

function Rotas() {
  const { dia: diaBusca } = Route.useSearch();
  const [dia, setDia] = useState(diaBusca ?? todayISO());
  const [tecnicoId, setTecnicoId] = useState("todos");
  const [kmReal, setKmReal] = useState("");
  const [motivo, setMotivo] = useState("");
  const [auto, setAuto] = useState<RotaAuto | null>(null);
  const [sync, setSync] = useState<Awaited<ReturnType<typeof sincronizarRotaDoDia>> | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mesFechamento, setMesFechamento] = useState(currentMonth());
  const [tecnicoFechamento, setTecnicoFechamento] = useState("todos");
  const [fechando, setFechando] = useState(false);
  const [fechamento, setFechamento] = useState<Awaited<
    ReturnType<typeof fecharQuilometragemDoMes>
  > | null>(null);
  const sincronizar = useServerFn(sincronizarRotaDoDia);
  const fechar = useServerFn(fecharQuilometragemDoMes);
  const { data: tecnicos } = useTechnicians(false);
  const { data: custoKm } = useSetting<number>("cost_per_km", 0.57);
  const calcular = useServerFn(calcularRotaDoDia);
  const reprocessar = useServerFn(reprocessarRotasComErro);
  const [reprocessando, setReprocessando] = useState(false);

  async function reprocessarErros() {
    setReprocessando(true);
    try {
      const res = await reprocessar({ data: { days: 60 } });
      if (res.attempted === 0) {
        toast.info("Nenhuma rota com erro pendente de recálculo.");
      } else {
        toast.success(
          `${res.fixed} de ${res.attempted} rota(s) recalculada(s). ${res.stillFailing} ainda com erro.`,
        );
      }
      for (const e of res.errors.slice(0, 4)) toast.warning(e);
      await Promise.all([rotaQuery.refetch(), query.refetch()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível reprocessar as rotas.");
    } finally {
      setReprocessando(false);
    }
  }

  const query = useQuery({
    queryKey: ["rota", dia],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("scheduled_date", dia)
        .neq("status", "Cancelado")
        .order("scheduled_time");
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  const rotaQuery = useQuery({
    queryKey: ["daily_route", dia, tecnicoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_routes")
        .select("*")
        .eq("route_date", dia)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const visitas = useMemo(
    () =>
      (query.data ?? []).filter((v) => tecnicoId === "todos" || v.technician?.id === tecnicoId),
    [query.data, tecnicoId],
  );

  const kmAuto = auto?.totalKm ?? Number(rotaQuery.data?.calculated_km ?? 0);
  const kmManual = parseNumberBR(kmReal || "0");
  const km = kmManual > 0 ? kmManual : kmAuto;
  const custoTotal = Math.round(km * Number(custoKm ?? 0) * 100) / 100;
  const rateio = visitas.length ? Math.round((custoTotal / visitas.length) * 100) / 100 : 0;

  const enderecos = visitas
    .map((v, i) => `${i + 1}. ${timeBR(v.scheduled_time)} — ${v.work_order?.customer?.full_address ?? ""}`)
    .join("\n");

  async function calcularAutomatico() {
    setCalculando(true);
    try {
      const res = await calcular({
        data: { date: dia, technicianId: tecnicoId === "todos" ? null : tecnicoId },
      });
      setAuto(res);
      setKmReal("");
      for (const f of res.failures) toast.warning(f);
      if (res.totalKm > 0) {
        toast.success(
          `Trajeto calculado: ${res.totalKm.toFixed(1).replace(".", ",")} km em ${res.stops} parada(s).`,
        );
      } else if (res.failures.length === 0) {
        toast.info("Nenhuma parada com endereço válido neste dia.");
      }
    } catch {
      toast.error("Não foi possível calcular a quilometragem agora. Tente novamente.");
    } finally {
      setCalculando(false);
    }
  }

  async function salvarRota() {
    setSalvando(true);
    try {
      const technicianId = tecnicoId === "todos" ? null : tecnicoId;

      // Ajuste manual do dia é gravado antes da sincronização, para virar a base do custo.
      if (kmManual > 0) {
        let existQuery = supabase.from("daily_routes").select("id").eq("route_date", dia);
        existQuery = technicianId
          ? existQuery.eq("technician_id", technicianId)
          : existQuery.is("technician_id", null);
        const { data: existente } = await existQuery.maybeSingle();
        const payload = {
          real_km: kmManual,
          adjustment_reason: motivo.trim() || null,
          cost_per_km: Number(custoKm ?? 0),
        };
        if (existente?.id) {
          await supabase.from("daily_routes").update(payload).eq("id", existente.id);
        } else {
          await supabase
            .from("daily_routes")
            .insert({ route_date: dia, technician_id: technicianId, ...payload });
        }
      }

      const res = await sincronizar({
        data: { date: dia, technicianId, source: "manual" },
      });
      setSync(res);
      for (const f of res.failures) toast.warning(f);
      if (res.status === "Custo gerado") {
        toast.success(
          `${res.message} ${brl(res.totalCost)} de quilometragem e ${brl(res.allocatedPerService)} rateado em ${res.concluidos} serviço(s).`,
        );
      } else if (res.status === "Aguardando conclusão dos serviços") {
        toast.warning(res.message);
      } else {
        toast.info(res.message);
      }

      if (res.financialDifference) {
        toast.warning(
          `A despesa desta rota já foi paga (${brl(res.paidAmount ?? 0)}) e o valor recalculado é ${brl(res.totalCost)}. Revise em Despesas.`,
        );
      }
      rotaQuery.refetch();
      query.refetch();
    } catch (error) {
      toast.error(`Não foi possível salvar a rota: ${(error as Error).message}`);
    } finally {
      setSalvando(false);
    }
  }

  async function fecharMes() {
    setFechando(true);
    try {
      const res = await fechar({
        data: {
          month: mesFechamento,
          technicianId: tecnicoFechamento === "todos" ? null : tecnicoFechamento,
        },
      });
      setFechamento(res);
      for (const e of res.errors) toast.warning(e);
      const comValor = res.technicians.filter((t) => t.amountDue > 0);
      if (comValor.length === 0) {
        toast.info("Nenhuma quilometragem a pagar neste mês.");
      } else {
        toast.success(
          `Quilometragem do mês fechada: ${brl(res.totalCost)} em ${comValor.length} despesa(s) pendente(s).`,
        );
      }
      const difs = res.technicians.filter((t) => t.financialDifference);
      for (const t of difs) {
        toast.warning(`${t.technicianName}: a despesa do mês já foi paga e o valor recalculado é ${brl(t.amountDue)}.`);
      }
      rotaQuery.refetch();
      query.refetch();
    } catch (error) {
      toast.error(`Não foi possível fechar a quilometragem do mês: ${(error as Error).message}`);
    } finally {
      setFechando(false);
    }
  }




  return (
    <>
      <PageHeader
        title="Rotas e quilometragem"
        description={`${dateBR(dia)} · ${visitas.length} parada(s) · custo por km ${brl(custoKm)}`}
      />

      <div className="card-surface mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="dia">Dia</Label>
          <Input id="dia" type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="w-[170px]" />
        </div>
        <div className="space-y-1">
          <Label>Técnico</Label>
          <Select value={tecnicoId} onValueChange={setTecnicoId}>
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {(tecnicos ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="km">Ajuste manual da quilometragem (opcional)</Label>
          <Input
            id="km"
            value={kmReal}
            onChange={(e) => setKmReal(e.target.value)}
            placeholder={kmAuto ? kmAuto.toFixed(1).replace(".", ",") : "0"}
            className="w-[220px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="motivo">Motivo do ajuste (opcional)</Label>
          <Input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="w-[220px]" />
        </div>
        <Button onClick={calcularAutomatico} disabled={calculando}>
          {calculando ? "Calculando..." : "Calcular quilometragem automaticamente"}
        </Button>
        <Button variant="outline" onClick={salvarRota} disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar rota e ratear custo do dia"}
        </Button>
      </div>

      <section className="card-surface mb-6 p-4">
        <h2 className="text-lg font-semibold">Fechamento mensal da quilometragem</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Calcula todas as rotas do mês e lança uma única despesa pendente por técnico.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="mesFech">Mês</Label>
            <Input
              id="mesFech"
              type="month"
              value={mesFechamento}
              onChange={(e) => setMesFechamento(e.target.value)}
              className="w-[170px]"
            />
          </div>
          <div className="space-y-1">
            <Label>Técnico</Label>
            <Select value={tecnicoFechamento} onValueChange={setTecnicoFechamento}>
              <SelectTrigger className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {(tecnicos ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={fecharMes} disabled={fechando}>
            {fechando ? "Fechando o mês..." : "Fechar quilometragem do mês"}
          </Button>
        </div>

        {fechamento ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-secondary text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Técnico</th>
                  <th className="px-4 py-2 font-medium">Dias</th>
                  <th className="px-4 py-2 font-medium">Km do mês</th>
                  <th className="px-4 py-2 font-medium">Já pago</th>
                  <th className="px-4 py-2 font-medium">A pagar</th>
                  <th className="px-4 py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {fechamento.technicians.map((t) => (
                  <tr key={t.technicianId ?? "sem"} className="border-t border-border">
                    <td className="px-4 py-2">{t.technicianName}</td>
                    <td className="px-4 py-2">{t.days.length}</td>
                    <td className="px-4 py-2">{t.totalKm.toFixed(1).replace(".", ",")} km</td>
                    <td className="px-4 py-2">{brl(t.alreadyPaid)}</td>
                    <td className="px-4 py-2 font-semibold">{brl(t.amountDue)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{t.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>


      <div className="card-surface mb-6 p-4">
        <p className="text-sm text-muted-foreground">Situação da rota</p>
        <p className="text-lg font-semibold">
          {sync?.status ?? rotaQuery.data?.route_status ?? "Não calculada"}
        </p>
        {sync?.message ? <p className="text-sm text-muted-foreground">{sync.message}</p> : null}
        {rotaQuery.data?.financial_difference ? (
          <p className="mt-1 text-sm text-warning-foreground">
            A rota foi alterada depois do pagamento da despesa. Revise o valor em Despesas.
          </p>
        ) : null}
        {rotaQuery.data?.error_message ? (
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
            {String(rotaQuery.data.error_message)
              .split(" · ")
              .map((m, i) => (
                <li key={i}>• {m}</li>
              ))}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={reprocessarErros} disabled={reprocessando}>
            {reprocessando ? "Recalculando..." : "Recalcular rotas com erro"}
          </Button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          label="Quilometragem do dia"
          value={`${km.toFixed(1).replace(".", ",")} km`}
          hint={kmManual > 0 && kmAuto > 0 ? `Automático: ${kmAuto.toFixed(1).replace(".", ",")} km` : undefined}
        />
        <Card
          label="Combustível a pagar ao técnico"
          value={brl(custoTotal)}
          hint={`${brl(custoKm)} por km`}
        />
        <Card label="Custo rateado por serviço" value={brl(rateio)} />
        <Card
          label="Tempo estimado de deslocamento"
          value={auto?.totalMinutes ? `${Math.floor(auto.totalMinutes / 60)}h ${auto.totalMinutes % 60}min` : "—"}
        />
      </div>

      {auto?.legs?.length ? (
        <section className="card-surface mb-6 overflow-x-auto">
          <h2 className="px-4 pt-4 text-lg font-semibold">Trechos calculados</h2>
          <p className="px-4 pb-3 text-sm text-muted-foreground">
            Saída da casa do técnico até o último atendimento, sem a volta para casa.
          </p>
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="px-4 py-2 font-medium">De</th>
                <th className="px-4 py-2 font-medium">Para</th>
                <th className="px-4 py-2 font-medium">Km</th>
                <th className="px-4 py-2 font-medium">Tempo</th>
              </tr>
            </thead>
            <tbody>
              {auto.legs.map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2">{l.from}</td>
                  <td className="px-4 py-2">{l.to}</td>
                  <td className="px-4 py-2">{l.km.toFixed(1).replace(".", ",")}</td>
                  <td className="px-4 py-2">{l.minutes} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {auto?.failures?.length ? (
        <section className="card-surface mb-6 p-4">
          <h2 className="mb-2 text-base font-semibold">Endereços a corrigir</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {auto.failures.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </section>
      ) : null}


      {visitas.length === 0 ? (
        <EmptyState title="Nenhum serviço neste dia" description="Escolha outra data." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card-surface p-5">
            <h2 className="mb-3 text-lg font-semibold">Roteiro do dia</h2>
            <ol className="space-y-3">
              {visitas.map((v, i) => (
                <li key={v.id} className="rounded-lg border border-border p-3">
                  <p className="font-medium">
                    {i + 1}. {timeBR(v.scheduled_time)} · {v.work_order?.customer?.full_name}
                  </p>
                  <p className="text-sm text-muted-foreground">{v.work_order?.customer?.full_address}</p>
                  <p className="text-sm text-muted-foreground">
                    Custo rateado atual: {brl(v.mileage_cost_allocated)}
                  </p>
                  {mapsLink(v.work_order?.customer?.full_address) ? (
                    <Button variant="outline" size="sm" className="mt-2" asChild>
                      <a
                        href={mapsLink(v.work_order?.customer?.full_address)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir no mapa
                      </a>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <section className="card-surface p-5">
            <h2 className="mb-3 text-lg font-semibold">Endereços em sequência</h2>
            <Textarea readOnly value={enderecos} className="min-h-[240px] font-mono text-sm" />
          </section>
        </div>
      )}
    </>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div className="card-surface p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
