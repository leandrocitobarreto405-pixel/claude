import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Flame, MessageSquareText, Target, TrendingUp, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionCard } from "@/components/app-shell";
import { KpiCard, LeadLink, StatusPill, TemperatureBadge } from "@/components/crm-ui";
import { supabase } from "@/integrations/supabase/client";
import { CRM_STATUS_KIND, formatPhoneBR, statusMeta, useCrmCatalog } from "@/lib/crm";
import { brl, currentMonth, dateTimeBR, monthEnd, monthStart, pct } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/crm/visao-geral")({
  head: () => ({
    meta: [
      { title: "Visão geral do CRM — Turbine Clean" },
      {
        name: "description",
        content:
          "Leads do WhatsApp, conversão, custo por lead e desempenho das campanhas no período.",
      },
      { property: "og:title", content: "Visão geral do CRM — Turbine Clean" },
      {
        property: "og:description",
        content:
          "Leads do WhatsApp, conversão, custo por lead e desempenho das campanhas no período.",
      },
    ],
  }),
  component: VisaoGeral,
});

function VisaoGeral() {
  const mes = currentMonth();
  const [de, setDe] = useState(monthStart(mes));
  const [ate, setAte] = useState(monthEnd(mes));
  const { data: statuses } = useCrmCatalog(CRM_STATUS_KIND, false);

  const leads = useQuery({
    queryKey: ["crm_dashboard_leads", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select(
          `id, lead_name, phone, temperature, temperature_confirmed, status_id, is_open, first_contact_date,
           last_interaction_at, next_follow_up_at, linked_work_order_id, campaign_id,
           campaign:campaign_id ( id, campaign_name, platform )`,
        )
        .gte("first_contact_date", de)
        .lte("first_contact_date", ate)
        .order("first_contact_date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const investimentos = useQuery({
    queryKey: ["crm_dashboard_invest", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_investments")
        .select("campaign_id, amount, reference_date")
        .gte("reference_date", de)
        .lte("reference_date", ate);
      if (error) throw error;
      return data ?? [];
    },
  });

  const receita = useQuery({
    queryKey: ["crm_dashboard_receita", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select("campaign_id, work_order:linked_work_order_id ( total_gross_value, status )")
        .not("linked_work_order_id", "is", null)
        .gte("first_contact_date", de)
        .lte("first_contact_date", ate)
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const resumo = useMemo(() => {
    const rows = leads.data ?? [];
    const total = rows.length;
    const quentes = rows.filter((l) => l.temperature === "QUENTE").length;
    const convertidos = rows.filter((l) => l.linked_work_order_id).length;
    const abertos = rows.filter((l) => l.is_open).length;
    const perdidos = rows.filter((l) => {
      const s = (statuses ?? []).find((x) => x.id === l.status_id);
      return statusMeta(s).lost;
    }).length;
    const investido = (investimentos.data ?? []).reduce((s, i) => s + Number(i.amount ?? 0), 0);
    const receitaTotal = (receita.data ?? []).reduce((s, r) => {
      const wo = r.work_order as { total_gross_value?: number; status?: string } | null;
      if (!wo || wo.status === "Cancelada") return s;
      return s + Number(wo.total_gross_value ?? 0);
    }, 0);
    return {
      total,
      quentes,
      convertidos,
      abertos,
      perdidos,
      investido,
      receitaTotal,
      conversao: total > 0 ? convertidos / total : 0,
      custoPorLead: total > 0 ? investido / total : 0,
      custoPorVenda: convertidos > 0 ? investido / convertidos : 0,
      roi: investido > 0 ? receitaTotal / investido : 0,
    };
  }, [leads.data, investimentos.data, receita.data, statuses]);

  const porStatus = useMemo(() => {
    const rows = leads.data ?? [];
    return (statuses ?? []).map((s) => ({
      status: s,
      total: rows.filter((l) => l.status_id === s.id).length,
    }));
  }, [leads.data, statuses]);

  const porCampanha = useMemo(() => {
    const rows = leads.data ?? [];
    const map = new Map<
      string,
      { nome: string; leads: number; vendas: number; investido: number; receita: number }
    >();
    for (const l of rows) {
      const camp = l.campaign as { id: string; campaign_name: string } | null;
      const key = camp?.id ?? "sem-campanha";
      const atual = map.get(key) ?? {
        nome: camp?.campaign_name ?? "Sem campanha",
        leads: 0,
        vendas: 0,
        investido: 0,
        receita: 0,
      };
      atual.leads += 1;
      if (l.linked_work_order_id) atual.vendas += 1;
      map.set(key, atual);
    }
    for (const i of investimentos.data ?? []) {
      const key = i.campaign_id ?? "sem-campanha";
      const atual = map.get(key);
      if (atual) atual.investido += Number(i.amount ?? 0);
    }
    for (const r of receita.data ?? []) {
      const key = r.campaign_id ?? "sem-campanha";
      const atual = map.get(key);
      const wo = r.work_order as { total_gross_value?: number; status?: string } | null;
      if (atual && wo && wo.status !== "Cancelada")
        atual.receita += Number(wo.total_gross_value ?? 0);
    }
    return [...map.values()].sort((a, b) => b.leads - a.leads);
  }, [leads.data, investimentos.data, receita.data]);

  const recentes = (leads.data ?? []).slice(0, 8);

  return (
    <>
      <PageHeader
        title="CRM WhatsApp"
        description="Acompanhe leads, conversão e retorno das campanhas no período escolhido."
      />

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="grid gap-1.5">
          <Label htmlFor="de">De</Label>
          <Input id="de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ate">Até</Label>
          <Input id="ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={MessageSquareText}
          label="Leads no período"
          value={String(resumo.total)}
          hint={`${resumo.abertos} em aberto · ${resumo.perdidos} perdidos`}
        />
        <KpiCard
          icon={Flame}
          label="Leads quentes"
          value={String(resumo.quentes)}
          hint={resumo.total > 0 ? `${pct(resumo.quentes / resumo.total)} do total` : undefined}
          accent="warning"
        />
        <KpiCard
          icon={Target}
          label="Convertidos em OS"
          value={String(resumo.convertidos)}
          hint={`Conversão de ${pct(resumo.conversao)}`}
          accent="success"
        />
        <KpiCard
          icon={Wallet}
          label="Investimento"
          value={brl(resumo.investido)}
          hint={`Custo por lead ${brl(resumo.custoPorLead)}`}
        />
        <KpiCard
          icon={TrendingUp}
          label="Receita das vendas"
          value={brl(resumo.receitaTotal)}
          hint={
            resumo.investido > 0
              ? `Retorno de ${resumo.roi.toFixed(2)}x`
              : "Sem investimento lançado"
          }
          accent="success"
        />
        <KpiCard
          icon={Target}
          label="Custo por venda"
          value={resumo.convertidos > 0 ? brl(resumo.custoPorVenda) : "—"}
          hint="Investimento dividido pelas vendas do período"
        />
        <KpiCard
          icon={CalendarClock}
          label="Com repescagem marcada"
          value={String((leads.data ?? []).filter((l) => l.next_follow_up_at).length)}
          hint="Retornos combinados com o cliente"
          accent="navy"
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Leads por etapa" description="Distribuição no funil dentro do período.">
          <div className="grid gap-2">
            {porStatus.map((s) => (
              <div key={s.status.id} className="flex items-center justify-between gap-3">
                <StatusPill status={s.status} />
                <span className="text-sm font-semibold text-navy">{s.total}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Desempenho por campanha" accent="navy">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Campanha</th>
                  <th className="py-2 pr-3">Leads</th>
                  <th className="py-2 pr-3">Vendas</th>
                  <th className="py-2 pr-3">Investido</th>
                  <th className="py-2 pr-3">Custo/lead</th>
                  <th className="py-2">Receita</th>
                </tr>
              </thead>
              <tbody>
                {porCampanha.map((c) => (
                  <tr key={c.nome} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 font-medium text-navy">{c.nome}</td>
                    <td className="py-2 pr-3">{c.leads}</td>
                    <td className="py-2 pr-3">{c.vendas}</td>
                    <td className="py-2 pr-3">{brl(c.investido)}</td>
                    <td className="py-2 pr-3">{c.leads > 0 ? brl(c.investido / c.leads) : "—"}</td>
                    <td className="py-2">{brl(c.receita)}</td>
                  </tr>
                ))}
                {porCampanha.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-muted-foreground">
                      Nenhum lead no período.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title="Últimos leads" description="Os contatos mais recentes do período.">
          <div className="grid gap-2">
            {recentes.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <LeadLink id={l.id}>{l.lead_name || "Sem nome"}</LeadLink>
                  <p className="text-xs text-muted-foreground">
                    {formatPhoneBR(l.phone)} ·{" "}
                    {l.last_interaction_at ? dateTimeBR(l.last_interaction_at) : "sem interação"}
                  </p>
                </div>
                <TemperatureBadge
                  temperature={l.temperature}
                  suggested={!l.temperature_confirmed}
                />
              </div>
            ))}
            {recentes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum lead no período.</p>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
