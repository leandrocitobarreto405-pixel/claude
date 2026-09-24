import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { SugestaoDiasCep } from "@/components/sugestao-dias-cep";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { StatusBadge, VisitDialog } from "@/components/visit-dialog";
import { BudgetVisitDialog } from "@/components/budget-visit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { VISIT_SELECT, type VisitRow } from "@/lib/os";
import { BUDGET_VISIT_SELECT, type BudgetVisitRow } from "@/lib/budget-visits";
import { VISIT_STATUSES, useTechnicians } from "@/lib/data";
import { addDaysISO, brl, dateBR, monthEnd, monthStart, timeBR, todayISO, weekdayPT } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/agenda")({
  validateSearch: (search: Record<string, unknown>) => {
    const modo = String(search["modo"] ?? "dia");
    return {
      modo: (["dia", "semana", "mes", "atrasados", "sem-tecnico"] as const).includes(modo as Modo)
        ? (modo as Modo)
        : ("dia" as const),
      tecnico: search["tecnico"] ? String(search["tecnico"]) : undefined,
      status: search["status"] ? String(search["status"]) : undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Agenda — Turbine Clean" },
      { name: "description", content: "Agenda de serviços por dia, semana e mês, com atrasados e serviços sem técnico." },
      { property: "og:title", content: "Agenda — Turbine Clean" },
      { property: "og:description", content: "Agenda de serviços por dia, semana e mês, com atrasados e serviços sem técnico." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Agenda,
});

type Modo = "dia" | "semana" | "mes" | "atrasados" | "sem-tecnico";

/** Serviços considerados em aberto (mesmo critério das pendências do início). */
const ATRASADOS_STATUSES = ["Agendado", "Em execução", "Reagendado"];

/** Visitas de orçamento ainda em aberto. */
const ORCAMENTOS_ABERTOS = ["Agendado", "Confirmado", "Em deslocamento", "Reagendado"];

function rangeFor(modo: Modo, ref: string) {
  if (modo === "dia") return { from: ref, to: ref };
  if (modo === "semana") {
    const d = new Date(`${ref}T12:00:00`);
    const start = addDaysISO(ref, -((d.getDay() + 6) % 7));
    return { from: start, to: addDaysISO(start, 6) };
  }
  const month = ref.slice(0, 7);
  return { from: monthStart(month), to: monthEnd(month) };
}

function Agenda() {
  const search = Route.useSearch();
  const [modo, setModo] = useState<Modo>(search.modo);
  const [ref, setRef] = useState(todayISO());
  const [tecnico, setTecnico] = useState(search.tecnico ?? "todos");
  const [status, setStatus] = useState(search.status ?? "todos");
  const [selecionada, setSelecionada] = useState<VisitRow | null>(null);
  const [orcamento, setOrcamento] = useState<BudgetVisitRow | null>(null);
  const [novoOrcamento, setNovoOrcamento] = useState(false);
  const { data: tecnicos } = useTechnicians(false);

  const especial = modo === "atrasados" || modo === "sem-tecnico";
  const { from, to } = rangeFor(especial ? "dia" : modo, ref);

  const query = useQuery({
    queryKey: ["agenda", especial ? modo : `${from}_${to}`],
    queryFn: async () => {
      let q = supabase.from("visits").select(VISIT_SELECT);
      if (modo === "atrasados") {
        q = q.lt("scheduled_date", todayISO()).in("status", ATRASADOS_STATUSES);
      } else if (modo === "sem-tecnico") {
        q = q.is("technician_id", null).neq("status", "Cancelado");
      } else {
        q = q.gte("scheduled_date", from).lte("scheduled_date", to);
      }
      const { data, error } = await q.order("scheduled_date").order("scheduled_time");
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  const orcamentosQuery = useQuery({
    queryKey: ["orcamentos", "agenda", especial ? modo : `${from}_${to}`],
    queryFn: async () => {
      let q = supabase.from("budget_visits").select(BUDGET_VISIT_SELECT);
      if (modo === "atrasados") {
        q = q.lt("scheduled_date", todayISO()).in("status", ORCAMENTOS_ABERTOS);
      } else if (modo === "sem-tecnico") {
        q = q.is("technician_id", null).neq("status", "Cancelado");
      } else {
        q = q.gte("scheduled_date", from).lte("scheduled_date", to);
      }
      const { data, error } = await q.order("scheduled_date").order("scheduled_time");
      if (error) throw error;
      return (data ?? []) as unknown as BudgetVisitRow[];
    },
  });

  const visitas = useMemo(
    () =>
      (query.data ?? []).filter(
        (v) =>
          (tecnico === "todos" || v.technician?.id === tecnico) &&
          (status === "todos" || v.status === status),
      ),
    [query.data, tecnico, status],
  );

  const orcamentos = useMemo(
    () =>
      (orcamentosQuery.data ?? []).filter(
        (v) =>
          (tecnico === "todos" || v.technician?.id === tecnico) &&
          (status === "todos" || v.status === status),
      ),
    [orcamentosQuery.data, tecnico, status],
  );

  type Item =
    | { kind: "os"; date: string; time: string; visit: VisitRow }
    | { kind: "orcamento"; date: string; time: string; budget: BudgetVisitRow };

  const grupos = useMemo(() => {
    const itens: Item[] = [
      ...visitas.map<Item>((v) => ({
        kind: "os",
        date: v.scheduled_date,
        time: v.scheduled_time,
        visit: v,
      })),
      ...orcamentos.map<Item>((b) => ({
        kind: "orcamento",
        date: b.scheduled_date,
        time: b.scheduled_time,
        budget: b,
      })),
    ];
    const map = new Map<string, Item[]>();
    for (const item of itens) {
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visitas, orcamentos]);

  const step = modo === "dia" ? 1 : modo === "semana" ? 7 : 30;
  const total = visitas.reduce((s, v) => s + Number(v.final_value ?? v.visit_value ?? 0), 0);
  const contagem = visitas.length + orcamentos.length;

  function recarregar() {
    void query.refetch();
    void orcamentosQuery.refetch();
  }

  return (
    <>
      <PageHeader
        title="Agenda de serviços"
        description={
          modo === "atrasados"
            ? `Atendimentos atrasados sem conclusão · ${contagem} item(ns) · ${brl(total)}`
            : modo === "sem-tecnico"
              ? `Atendimentos sem técnico definido · ${contagem} item(ns) · ${brl(total)}`
              : `${dateBR(from)} a ${dateBR(to)} · ${contagem} item(ns) · ${brl(total)} em serviços${
                  orcamentos.length ? ` · ${orcamentos.length} visita(s) de orçamento` : ""
                }`
        }
        actions={
          <Button onClick={() => setNovoOrcamento(true)}>
            <Plus className="size-4" /> Visita de orçamento
          </Button>
        }
      />

      <SugestaoDiasCep
        onEscolher={(dia) => {
          setModo("dia");
          setRef(dia);
        }}
      />

      <div className="card-surface mb-6 flex flex-wrap items-end gap-3 p-4">

        <Tabs
          value={modo}
          onValueChange={(v) => setModo(v as Modo)}
          className="w-full min-w-0 sm:w-auto"
        >
          <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="dia">Dia</TabsTrigger>
            <TabsTrigger value="semana">Semana</TabsTrigger>
            <TabsTrigger value="mes">Mês</TabsTrigger>
            <TabsTrigger value="atrasados">Atrasados</TabsTrigger>
            <TabsTrigger value="sem-tecnico">Sem técnico</TabsTrigger>
          </TabsList>
        </Tabs>


        {especial ? null : (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setRef(addDaysISO(ref, -step))}>
              <ChevronLeft className="size-4" />
            </Button>
            <Input type="date" value={ref} onChange={(e) => setRef(e.target.value)} className="w-[160px]" />
            <Button variant="outline" size="icon" onClick={() => setRef(addDaysISO(ref, step))}>
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="ghost" onClick={() => setRef(todayISO())}>
              Hoje
            </Button>
          </div>
        )}


        <div className="space-y-1">
          <Label>Técnico</Label>
          <Select value={tecnico} onValueChange={setTecnico}>
            <SelectTrigger className="w-[180px]">
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
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {VISIT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {grupos.length === 0 ? (
        <EmptyState
          title="Nenhum atendimento neste período"
          description="Altere o período ou os filtros para ver outros agendamentos."
        />
      ) : (
        <div className="space-y-6">
          {grupos.map(([dia, lista]) => (
            <section key={dia} className="card-surface p-5">
              <h2 className="mb-3 text-lg font-semibold capitalize">
                {weekdayPT(dia)}, {dateBR(dia)}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({lista.length} atendimento(s))
                </span>
              </h2>
              <ul className="space-y-2">
                {lista.map((item) =>
                  item.kind === "os" ? (
                    <li key={`v-${item.visit.id}`}>
                      <button
                        type="button"
                        onClick={() => setSelecionada(item.visit)}
                        className="w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            {timeBR(item.visit.scheduled_time)} ·{" "}
                            {item.visit.work_order?.customer?.full_name}
                          </span>
                          <StatusBadge status={item.visit.status} />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          OS {item.visit.work_order?.os_number} · {item.visit.service_type?.name} ·{" "}
                          {item.visit.upholstery_description || item.visit.upholstery_type?.name} ·{" "}
                          {brl(item.visit.final_value ?? item.visit.visit_value)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {item.visit.technician?.name ?? "Sem técnico"} ·{" "}
                          {item.visit.work_order?.customer?.full_address}
                        </p>
                        {item.visit.status === "Reagendado com deslocamento" ? (
                          <p className="mt-1 text-xs font-medium text-warning">
                            Deslocamento realizado · serviço reagendado
                            {item.visit.rescheduled_to_visit_id ? " (novo atendimento criado)" : ""}
                          </p>
                        ) : null}
                        {item.visit.rescheduled_from_visit_id ? (
                          <p className="mt-1 text-xs font-medium text-primary">
                            Reagendamento de atendimento anterior
                            {item.visit.original_scheduled_date
                              ? ` de ${dateBR(item.visit.original_scheduled_date)}`
                              : ""}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  ) : (
                    <li key={`b-${item.budget.id}`}>
                      <button
                        type="button"
                        onClick={() => setOrcamento(item.budget)}
                        className="w-full rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-left transition-colors hover:bg-primary/10"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            {timeBR(item.budget.scheduled_time)} · {item.budget.customer?.full_name}
                          </span>
                          <StatusBadge status={item.budget.status} />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Visita de orçamento (sem OS)
                          {item.budget.upholstery_description
                            ? ` · ${item.budget.upholstery_description}`
                            : ""}
                          {Number(item.budget.visit_fee ?? 0) > 0
                            ? ` · taxa ${brl(item.budget.visit_fee)}`
                            : ""}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {item.budget.technician?.name ?? "Sem técnico"} ·{" "}
                          {item.budget.customer?.full_address}
                        </p>
                        {item.budget.generated_work_order ? (
                          <p className="mt-1 text-xs font-medium text-primary">
                            OS gerada: {item.budget.generated_work_order.os_number}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      )}

      <VisitDialog
        visit={selecionada}
        open={!!selecionada}
        onOpenChange={(v) => !v && setSelecionada(null)}
        onChanged={recarregar}
      />

      <BudgetVisitDialog
        visit={orcamento}
        open={!!orcamento}
        onOpenChange={(v) => !v && setOrcamento(null)}
        onChanged={recarregar}
      />

      <BudgetVisitDialog
        visit={null}
        open={novoOrcamento}
        onOpenChange={setNovoOrcamento}
        onChanged={recarregar}
      />
    </>
  );
}
