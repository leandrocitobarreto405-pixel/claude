import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, SectionCard } from "@/components/app-shell";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  Coins,
  Route as RouteIcon,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { StatusBadge, VisitDialog } from "@/components/visit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { VISIT_SELECT, type VisitRow } from "@/lib/os";
import { useMonthSummary } from "@/lib/reports";
import {
  brl,
  currentMonth,
  dateBR,
  monthLabelPT,
  remainingDaysInMonth,
  timeBR,
  todayISO,
  tomorrowISO,
  weekdayPT,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/inicio")({
  head: () => ({
    meta: [
      { title: "Início — Gestão Estofados" },
      { name: "description", content: "Painel do dia com meta do mês, agenda e pendências." },
      { property: "og:title", content: "Início — Gestão Estofados" },
      { property: "og:description", content: "Painel do dia com meta do mês, agenda e pendências." },
    ],
  }),
  component: Inicio,
});

function useVisitsBetween(from: string, to: string) {
  return useQuery({
    queryKey: ["visits_range", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .gte("scheduled_date", from)
        .lte("scheduled_date", to)
        .order("scheduled_date")
        .order("scheduled_time");
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });
}

function useGoal(month: string) {
  return useQuery({
    queryKey: ["monthly_goal", month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monthly_goals")
        .select("*")
        .eq("month", `${month}-01`)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function usePendencias() {
  return useQuery({
    queryKey: ["pendencias"],
    queryFn: async () => {
      const hoje = todayISO();
      const mesAtual = currentMonth();
      const [semTecnico, atrasadas, notas, naoPagos, despesas, despesasMes, rotasPend, rotasDif] = await Promise.all([
        supabase
          .from("visits")
          .select("id", { count: "exact", head: true })
          .is("technician_id", null)
          .neq("status", "Cancelado"),
        supabase
          .from("visits")
          .select("id", { count: "exact", head: true })
          .lt("scheduled_date", hoje)
          .in("status", ["Agendado", "Em execução", "Reagendado"]),
        supabase.from("invoice_tasks").select("id", { count: "exact", head: true }).eq("status", "Pendente"),
        supabase
          .from("payments")
          .select("id", { count: "exact", head: true })
          .in("payment_status", ["Não pago", "Parcialmente pago"]),
        supabase
          .from("expenses")
          .select("id", { count: "exact", head: true })
          .lt("due_date", hoje)
          .in("status", ["Pendente", "Parcialmente pago", "Vencido"])
          .is("deleted_at", null),
        supabase
          .from("expenses")
          .select("id", { count: "exact", head: true })
          .gte("competence_date", `${mesAtual}-01`)
          .in("status", ["Pendente", "Parcialmente pago", "Vencido"])
          .is("deleted_at", null),
        supabase
          .from("daily_routes")
          .select("id", { count: "exact", head: true })
          .in("route_status", [
            "Aguardando conclusão dos serviços",
            "Aguardando custo por km",
            "Erro no cálculo",
          ]),
        supabase
          .from("daily_routes")
          .select("id", { count: "exact", head: true })
          .eq("financial_difference", true),
      ]);
      return {
        semTecnico: semTecnico.count ?? 0,
        atrasadas: atrasadas.count ?? 0,
        notas: notas.count ?? 0,
        naoPagos: naoPagos.count ?? 0,
        despesas: despesas.count ?? 0,
        despesasMes: despesasMes.count ?? 0,
        rotasPend: rotasPend.count ?? 0,
        rotasDif: rotasDif.count ?? 0,
      };
    },
  });
}

function Inicio() {
  const month = currentMonth();
  const hoje = todayISO();
  const amanha = tomorrowISO();
  const { data: resumo } = useMonthSummary(month);
  const { data: meta } = useGoal(month);
  const { data: pend } = usePendencias();
  const visitasHoje = useVisitsBetween(hoje, hoje);
  const visitasAmanha = useVisitsBetween(amanha, amanha);
  const [selecionada, setSelecionada] = useState<VisitRow | null>(null);

  const metaValor = Number(meta?.goal_amount ?? 0);
  // Faturamento = valor efetivamente recebido no mês (pagamentos ativos).
  const realizado = resumo?.received ?? 0;
  const percentual = metaValor > 0 ? Math.min(100, (realizado / metaValor) * 100) : 0;
  const faltam = Math.max(0, metaValor - realizado);
  const diasRestantes = remainingDaysInMonth(month);

  function recarregar() {
    visitasHoje.refetch();
    visitasAmanha.refetch();
  }

  return (
    <>
      <PageHeader
        title={`Olá! Hoje é ${weekdayPT(hoje)}, ${dateBR(hoje)}`}
        description={`Visão geral de ${monthLabelPT(month)}`}
        actions={
          <Button asChild>
            <Link to="/nova-os">Nova OS</Link>
          </Button>
        }
      />

      <section className="card-surface card-accent-teal mb-6 p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Meta de faturamento do mês</p>
            <p className="mt-1 text-3xl font-bold text-navy md:text-4xl">
              {brl(realizado)}{" "}
              <span className="text-base font-medium text-muted-foreground">de {brl(metaValor)}</span>
            </p>
          </div>
          <div className="text-right text-sm">
            <Badge variant={percentual >= 100 ? "success" : "info"} className="mb-1">
              {percentual.toFixed(1).replace(".", ",")}% da meta
            </Badge>
            <p className="text-muted-foreground">
              Faltam {brl(faltam)} em {diasRestantes} dia(s)
            </p>
          </div>
        </div>
        <Progress
          value={percentual}
          className="mt-4 h-3 bg-secondary [&>div]:bg-linear-to-r [&>div]:from-primary [&>div]:to-navy"
        />
        {metaValor === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhuma meta definida para este mês.{" "}
            <Link to="/configuracoes" className="font-medium text-primary underline">
              Definir meta
            </Link>
          </p>
        ) : null}
      </section>

      <section className="mb-6">
        <h2 className="section-title mb-3">Operação</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={CalendarClock} label="Serviços de hoje" value={String(visitasHoje.data?.length ?? 0)} />
          <Kpi icon={BadgeCheck} label="Serviços concluídos no mês" value={String(resumo?.completedCount ?? 0)} />
          <Kpi
            icon={CalendarClock}
            label="Serviços atrasados"
            value={String(pend?.atrasadas ?? 0)}
            accent="warning"
            to="/agenda"
            search={{ modo: "atrasados" }}
          />
          <Kpi
            icon={RouteIcon}
            label="Rotas aguardando cálculo"
            value={String(pend?.rotasPend ?? 0)}
            accent="warning"
            to="/rotas"
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="section-title mb-3">Financeiro</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            icon={TrendingUp}
            label="Recebido líquido no mês"
            value={brl(resumo?.receivedNet)}
            hint={`Bruto ${brl(resumo?.received)} · Taxas ${brl(resumo?.fees)}`}
            accent="success"
            to="/pagamentos"
          />
          <Kpi
            icon={Wallet}
            label="A receber"
            value={brl(resumo?.receivable)}
            hint={`Concluídos ${brl(resumo?.receivableCompleted)} · Agendados ${brl(resumo?.receivableScheduled)}`}
            to="/a-receber"
            search={{ aba: "concluido" }}
          />
          <Kpi
            icon={Coins}
            label="Despesas pendentes do mês"
            value={String(pend?.despesasMes ?? 0)}
            accent="warning"
            to="/despesas"
            search={{ aba: "Pendentes" }}
          />
          <Kpi icon={TrendingUp} label="Lucro líquido estimado" value={brl(resumo?.netProfit)} accent="navy" />
        </div>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-2">
        <DayList
          title={`Serviços de hoje (${visitasHoje.data?.length ?? 0})`}
          visits={visitasHoje.data ?? []}
          onSelect={setSelecionada}
        />
        <DayList
          title={`Serviços de amanhã (${visitasAmanha.data?.length ?? 0})`}
          visits={visitasAmanha.data ?? []}
          onSelect={setSelecionada}
        />
      </section>

      <SectionCard
        icon={AlertTriangle}
        title="Pendências"
        description="Itens que precisam da sua atenção agora."
        accent="warning"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Pend
            label="Serviços sem técnico definido"
            value={pend?.semTecnico ?? 0}
            to="/agenda"
            search={{ modo: "sem-tecnico" }}
          />
          <Pend
            label="Serviços atrasados sem conclusão"
            value={pend?.atrasadas ?? 0}
            to="/agenda"
            search={{ modo: "atrasados" }}
          />
          <Pend label="Notas fiscais a emitir" value={pend?.notas ?? 0} to="/notas" />
          <Pend
            label="OS com pagamento pendente"
            value={pend?.naoPagos ?? 0}
            to="/pagamentos"
            search={{ status: "Não pago" }}
          />
          <Pend
            label="Despesas vencidas"
            value={pend?.despesas ?? 0}
            to="/despesas"
            search={{ aba: "Vencidas" }}
          />
          <Pend
            label="Despesas pendentes do mês"
            value={pend?.despesasMes ?? 0}
            to="/despesas"
            search={{ aba: "Pendentes" }}
          />
          <Pend label="Rotas pendentes de cálculo" value={pend?.rotasPend ?? 0} to="/rotas" />
          <Pend label="Rotas alteradas após o pagamento" value={pend?.rotasDif ?? 0} to="/rotas" />
        </div>
      </SectionCard>


      <VisitDialog
        visit={selecionada}
        open={!!selecionada}
        onOpenChange={(v) => !v && setSelecionada(null)}
        onChanged={recarregar}
      />
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  accent = "teal",
  to,
  search,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: "teal" | "navy" | "success" | "warning";
  to?: string;
  search?: Record<string, string>;
}) {
  const accentClass =
    accent === "navy"
      ? "card-accent-navy"
      : accent === "success"
        ? "card-accent-success"
        : accent === "warning"
          ? "card-accent-warning"
          : "card-accent-teal";
  const inner = (
    <div className="flex items-start gap-3">
      {Icon ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
          <Icon className="size-4" />
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold text-navy">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
  if (to) {
    return (
      <Link
        to={to}
        search={search ?? {}}
        className={`card-surface ${accentClass} block p-4 transition-all duration-200 hover:border-primary/40 hover:bg-secondary/40`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={`card-surface ${accentClass} p-4`}>{inner}</div>;
}

function Pend({
  label,
  value,
  to,
  search,
}: {
  label: string;
  value: number;
  to: string;
  search?: Record<string, string>;
}) {
  return (
    <Link
      to={to}
      search={search ?? {}}
      className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 transition-all duration-200 hover:border-primary/40 hover:bg-secondary/60"
    >
      <span className="text-sm">{label}</span>
      <Badge variant={value > 0 ? "warning" : "muted"}>{value}</Badge>
    </Link>
  );
}


function DayList({
  title,
  visits,
  onSelect,
}: {
  title: string;
  visits: VisitRow[];
  onSelect: (v: VisitRow) => void;
}) {
  return (
    <SectionCard icon={CalendarClock} title={title} accent="navy">
      {visits.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nenhum serviço agendado"
          description="Aproveite para organizar as próximas vendas."
        />
      ) : (
        <ul className="space-y-2">
          {visits.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onSelect(v)}
                className="w-full rounded-xl border border-border bg-card p-3 text-left transition-all duration-200 hover:border-primary/40 hover:bg-secondary/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-navy">
                    {timeBR(v.scheduled_time)} · {v.work_order?.customer?.full_name}
                  </span>
                  <StatusBadge status={v.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  OS {v.work_order?.os_number} · {v.service_type?.name} ·{" "}
                  {v.upholstery_description || v.upholstery_type?.name} ·{" "}
                  {brl(v.final_value ?? v.visit_value)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {v.technician?.name ?? "Sem técnico"} · {v.work_order?.customer?.full_address}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
