import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { copiar, StatusBadge } from "@/components/visit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { VISIT_SELECT, fetchCollectionVisits, visitMessageContext, type VisitRow } from "@/lib/os";
import {
  BUDGET_VISIT_SELECT,
  budgetVisitMessageContext,
  type BudgetVisitRow,
} from "@/lib/budget-visits";
import { DEFAULT_MESSAGE_TEMPLATE, useSetting } from "@/lib/data";
import { dateBR, timeBR, tomorrowISO, weekdayPT, whatsappLink } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/mensagens")({
  head: () => ({
    meta: [
      { title: "Mensagens de amanhã — Gestão Estofados" },
      {
        name: "description",
        content: "Copie as mensagens de confirmação dos serviços do dia seguinte.",
      },
      { property: "og:title", content: "Mensagens de amanhã — Gestão Estofados" },
      {
        property: "og:description",
        content: "Copie as mensagens de confirmação dos serviços do dia seguinte.",
      },
    ],
  }),
  component: Mensagens,
});

function Mensagens() {
  const [dia, setDia] = useState(tomorrowISO());
  const { data: template } = useSetting<unknown>("message_template", DEFAULT_MESSAGE_TEMPLATE);

  const query = useQuery({
    queryKey: ["mensagens", dia],
    queryFn: async () => {
      const orcamentosRes = await supabase
        .from("budget_visits")
        .select(BUDGET_VISIT_SELECT)
        .eq("scheduled_date", dia)
        .neq("status", "Cancelado")
        .order("scheduled_time");
      if (orcamentosRes.error) throw orcamentosRes.error;
      const orcamentos = (orcamentosRes.data ?? []) as unknown as BudgetVisitRow[];
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("scheduled_date", dia)
        .neq("status", "Cancelado")
        .neq("status", "Reagendado com deslocamento")
        .order("scheduled_time");
      if (error) throw error;
      const rows = (data ?? []) as unknown as VisitRow[];
      const irmas = await fetchCollectionVisits(
        rows.map((r) => r.work_order?.id ?? r.work_order_id ?? ""),
      );
      return { rows, irmas, orcamentos };
    },
  });

  type Cartao = {
    id: string;
    time: string;
    title: string;
    subtitle: string;
    phone: string | null;
    status: string;
    orcamento: boolean;
    message: string;
  };

  const cartoes: Cartao[] = [
    ...(query.data?.rows ?? []).map((v) => ({
      id: v.id,
      time: v.scheduled_time,
      title: v.work_order?.customer?.full_name ?? "—",
      subtitle: `OS ${v.work_order?.os_number ?? "—"} · ${v.work_order?.customer?.phone ?? "—"}`,
      phone: v.work_order?.customer?.phone ?? null,
      status: v.status,
      orcamento: false,
      message: visitMessageContext(
        v,
        template,
        query.data?.irmas.get(v.work_order?.id ?? v.work_order_id ?? ""),
      ),
    })),
    ...(query.data?.orcamentos ?? []).map((b) => ({
      id: b.id,
      time: b.scheduled_time,
      title: b.customer?.full_name ?? "—",
      subtitle: `Visita de orçamento · ${b.customer?.phone ?? "—"}`,
      phone: b.customer?.phone ?? null,
      status: b.status,
      orcamento: true,
      message: budgetVisitMessageContext(b, template),
    })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  const todas = cartoes.map((c) => c.message).join("\n\n———\n\n");

  return (
    <>
      <PageHeader
        title="Mensagens de confirmação"
        description={`${weekdayPT(dia)}, ${dateBR(dia)} · ${cartoes.length} atendimento(s)`}
        actions={
          cartoes.length ? (
            <Button onClick={() => copiar(todas, "Todas as mensagens copiadas!")}>
              <Copy className="mr-2 size-4" /> Copiar todas
            </Button>
          ) : null
        }
      />

      <div className="card-surface mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="dia">Dia dos serviços</Label>
          <Input
            id="dia"
            type="date"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            className="w-[180px]"
          />
        </div>
        <Button variant="outline" onClick={() => setDia(tomorrowISO())}>
          Amanhã
        </Button>
      </div>

      {cartoes.length === 0 ? (
        <EmptyState
          title="Nenhum serviço neste dia"
          description="Escolha outra data para gerar as mensagens."
        />
      ) : (
        <div className="space-y-4">
          {cartoes.map((c) => (
            <section key={c.id} className="card-surface p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {timeBR(c.time)} · {c.title}
                    {c.orcamento ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Orçamento
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">{c.subtitle}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={c.status} />
                  <Button variant="outline" size="sm" onClick={() => copiar(c.message)}>
                    <Copy className="mr-2 size-4" /> Copiar mensagem
                  </Button>
                  {whatsappLink(c.phone, c.message) ? (
                    <Button size="sm" asChild>
                      <a href={whatsappLink(c.phone, c.message)!} target="_blank" rel="noreferrer">
                        Abrir no WhatsApp
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
              <Textarea readOnly value={c.message} className="min-h-[190px] font-mono text-sm" />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
