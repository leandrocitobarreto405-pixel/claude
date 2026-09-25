import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { LeadLink, StatusPill, TemperatureBadge } from "@/components/crm-ui";
import {
  CRM_STATUS_KIND,
  changeLeadStatus,
  formatPhoneBR,
  useCrmCatalog,
  useCrmInvalidate,
  useCrmLeads,
  type CrmLeadRow,
} from "@/lib/crm";
import { dateBR } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/crm/funil")({
  head: () => ({
    meta: [
      { title: "Funil de vendas — Nexa OS" },
      {
        name: "description",
        content: "Quadro do funil de leads do WhatsApp, com arrastar e soltar entre etapas.",
      },
      { property: "og:title", content: "Funil de vendas — Nexa OS" },
      {
        property: "og:description",
        content: "Quadro do funil de leads do WhatsApp, com arrastar e soltar entre etapas.",
      },
    ],
  }),
  component: Funil,
});

function Funil() {
  const { data: statuses } = useCrmCatalog(CRM_STATUS_KIND);
  const query = useCrmLeads({});
  const invalidate = useCrmInvalidate();
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);

  const colunas = useMemo(() => {
    const leads = query.data ?? [];
    const semStatus = leads.filter((l) => !l.status_id);
    const cols = (statuses ?? []).map((s) => ({
      status: s,
      leads: leads.filter((l) => l.status_id === s.id),
    }));
    if (semStatus.length > 0) {
      cols.unshift({
        status: { id: "", name: "Sem status", active: true, display_order: 0, metadata: {} },
        leads: semStatus,
      });
    }
    return cols;
  }, [query.data, statuses]);

  async function mover(leadId: string, statusId: string) {
    const status = (statuses ?? []).find((s) => s.id === statusId);
    const lead = (query.data ?? []).find((l) => l.id === leadId);
    if (!status || !lead || lead.status_id === statusId) return;
    try {
      await changeLeadStatus(lead, status, { source: "Funil (arrastar)" });
      toast.success(`${lead.lead_name || "Lead"} movido para "${status.name}".`);
      invalidate();
      void query.refetch();
    } catch {
      toast.error("Não foi possível mover o lead.");
    }
  }

  return (
    <>
      <PageHeader
        title="Funil"
        description="Arraste os cartões para mudar a etapa. Cada movimento fica registrado no histórico."
      />

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando funil...</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {colunas.map((col) => (
            <div
              key={col.status.id || "sem-status"}
              onDragOver={(e) => {
                if (!col.status.id) return;
                e.preventDefault();
                setAlvo(col.status.id);
              }}
              onDragLeave={() => setAlvo((prev) => (prev === col.status.id ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                setAlvo(null);
                if (arrastando && col.status.id) void mover(arrastando, col.status.id);
                setArrastando(null);
              }}
              className={cn(
                "flex w-[17rem] shrink-0 flex-col rounded-2xl border border-border bg-secondary/40 p-3",
                alvo === col.status.id && "border-primary bg-primary/5",
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <StatusPill status={col.status} />
                <span className="text-xs font-medium text-muted-foreground">
                  {col.leads.length}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {col.leads.map((lead: CrmLeadRow) => (
                  <article
                    key={lead.id}
                    draggable
                    onDragStart={() => setArrastando(lead.id)}
                    onDragEnd={() => setArrastando(null)}
                    className="cursor-grab rounded-xl border border-border bg-card p-3 shadow-card active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <LeadLink id={lead.id}>{lead.lead_name || "Sem nome"}</LeadLink>
                      <TemperatureBadge
                        temperature={lead.temperature}
                        suggested={!lead.temperature_confirmed}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{formatPhoneBR(lead.phone)}</p>
                    {lead.upholstery_description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-navy">
                        {lead.upholstery_description}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[0.7rem] text-muted-foreground">
                      {dateBR(lead.first_contact_date)}
                      {lead.campaign ? ` · ${lead.campaign.campaign_name}` : ""}
                    </p>
                  </article>
                ))}
                {col.leads.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    Nenhum lead nesta etapa
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
