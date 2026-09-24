import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { LeadLink, NativeSelect, StatusPill, TemperatureBadge } from "@/components/crm-ui";
import { useConfigOptions, useSalespeople } from "@/lib/data";
import {
  CRM_SERVICE_KIND,
  CRM_STATUS_KIND,
  createLead,
  formatPhoneBR,
  normalizePhone,
  useCrmCampaigns,
  useCrmCatalog,
  useCrmInvalidate,
  useCrmLeads,
  type LeadFilters,
} from "@/lib/crm";
import { dateBR, dateTimeBR, todayISO } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/crm/leads")({
  head: () => ({
    meta: [
      { title: "Leads do CRM — Turbine Clean" },
      { name: "description", content: "Lista completa de leads do WhatsApp com filtros por status, temperatura, campanha e vendedora." },
      { property: "og:title", content: "Leads do CRM — Turbine Clean" },
      { property: "og:description", content: "Lista completa de leads do WhatsApp com filtros por status, temperatura, campanha e vendedora." },
    ],
  }),
  component: Leads,
});

function Leads() {
  const [filters, setFilters] = useState<LeadFilters>({ onlyOpen: false });
  const [busca, setBusca] = useState("");
  const [novoAberto, setNovoAberto] = useState(false);

  const { data: statuses } = useCrmCatalog(CRM_STATUS_KIND);
  const { data: servicos } = useCrmCatalog(CRM_SERVICE_KIND);
  const { data: campanhas } = useCrmCampaigns();
  const { data: vendedoras } = useSalespeople();
  const { data: origens } = useConfigOptions("sales_origin");

  const query = useCrmLeads({ ...filters, search: busca });
  const leads = query.data ?? [];

  const resumo = useMemo(() => {
    const quentes = leads.filter((l) => l.temperature === "QUENTE").length;
    const convertidos = leads.filter((l) => l.linked_work_order_id).length;
    return { total: leads.length, quentes, convertidos };
  }, [leads]);

  function set(patch: Partial<LeadFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  return (
    <>
      <PageHeader
        title="Leads"
        description={`${resumo.total} lead(s) · ${resumo.quentes} quente(s) · ${resumo.convertidos} convertido(s) em OS`}
        actions={
          <Button className="gap-2" onClick={() => setNovoAberto(true)}>
            <Plus className="size-4" /> Novo lead
          </Button>
        }
      />

      <div className="card-surface mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5 lg:col-span-2">
            <Label htmlFor="busca">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="busca"
                value={busca}
                maxLength={120}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome, telefone, estofado, resumo, campanha ou número da OS"
                className="pl-9"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-de">De</Label>
            <Input id="f-de" type="date" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-ate">Até</Label>
            <Input id="f-ate" type="date" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-status">Status</Label>
            <NativeSelect
              id="f-status"
              placeholder="Todos"
              value={filters.statusId ?? ""}
              onChange={(v) => set({ statusId: v })}
              options={(statuses ?? []).map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-temp">Temperatura</Label>
            <NativeSelect
              id="f-temp"
              placeholder="Todas"
              value={filters.temperature ?? ""}
              onChange={(v) => set({ temperature: v })}
              options={[
                { value: "QUENTE", label: "Quente" },
                { value: "FRIO", label: "Frio" },
              ]}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-camp">Campanha</Label>
            <NativeSelect
              id="f-camp"
              placeholder="Todas"
              value={filters.campaignId ?? ""}
              onChange={(v) => set({ campaignId: v })}
              options={(campanhas ?? []).map((c) => ({ value: c.id, label: c.campaign_name }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-vend">Vendedora</Label>
            <NativeSelect
              id="f-vend"
              placeholder="Todas"
              value={filters.salespersonId ?? ""}
              onChange={(v) => set({ salespersonId: v })}
              options={(vendedoras ?? []).map((v) => ({ value: v.id, label: v.name }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-origem">Origem</Label>
            <NativeSelect
              id="f-origem"
              placeholder="Todas"
              value={filters.originId ?? ""}
              onChange={(v) => set({ originId: v })}
              options={(origens ?? []).map((o) => ({ value: o.id, label: o.name }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-serv">Serviço de interesse</Label>
            <NativeSelect
              id="f-serv"
              placeholder="Todos"
              value={filters.serviceInterest ?? ""}
              onChange={(v) => set({ serviceInterest: v })}
              options={(servicos ?? []).map((s) => ({ value: s.name, label: s.name }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-conv">Convertido em OS</Label>
            <NativeSelect
              id="f-conv"
              placeholder="Todos"
              value={filters.converted ?? ""}
              onChange={(v) => set({ converted: v === "sim" || v === "nao" ? v : undefined })}
              options={[
                { value: "sim", label: "Sim" },
                { value: "nao", label: "Não" },
              ]}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-abertos">Situação</Label>
            <NativeSelect
              id="f-abertos"
              placeholder="Todas"
              value={filters.onlyOpen ? "abertos" : ""}
              onChange={(v) => set({ onlyOpen: v === "abertos" })}
              options={[{ value: "abertos", label: "Somente em aberto" }]}
            />
          </div>
        </div>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando leads...</p>
      ) : leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum lead encontrado"
          description="Ajuste os filtros, cadastre um lead manualmente ou importe a planilha histórica."
          action={
            <Button variant="outline" asChild>
              <Link to="/crm/importar">Importar planilha</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop */}
          <div className="card-surface hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Estofado / serviço</th>
                  <th className="px-4 py-3">Temperatura</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Campanha</th>
                  <th className="px-4 py-3">Última interação</th>
                  <th className="px-4 py-3">OS</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-4 py-3">{dateBR(l.first_contact_date)}</td>
                    <td className="px-4 py-3">
                      <LeadLink id={l.id}>{l.lead_name || "Sem nome"}</LeadLink>
                      <p className="text-xs text-muted-foreground">{formatPhoneBR(l.phone)}</p>
                    </td>
                    <td className="max-w-[16rem] px-4 py-3">
                      <p className="truncate">{l.upholstery_description ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{l.service_interest ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <TemperatureBadge temperature={l.temperature} suggested={!l.temperature_confirmed} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={l.status} />
                    </td>
                    <td className="max-w-[12rem] px-4 py-3">
                      <p className="truncate text-xs">{l.campaign?.campaign_name ?? l.origem?.name ?? "—"}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {l.last_interaction_at ? dateTimeBR(l.last_interaction_at) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {l.work_order ? (
                        <Link
                          to="/os/$osNumber"
                          params={{ osNumber: l.work_order.os_number }}
                          className="text-primary hover:underline"
                        >
                          {l.work_order.os_number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="grid gap-3 lg:hidden">
            {leads.map((l) => (
              <div key={l.id} className="card-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <LeadLink id={l.id}>{l.lead_name || "Sem nome"}</LeadLink>
                    <p className="text-xs text-muted-foreground">{formatPhoneBR(l.phone)}</p>
                  </div>
                  <TemperatureBadge temperature={l.temperature} suggested={!l.temperature_confirmed} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusPill status={l.status} />
                  <span className="text-xs text-muted-foreground">{dateBR(l.first_contact_date)}</span>
                </div>
                {l.upholstery_description ? (
                  <p className="mt-2 text-sm">{l.upholstery_description}</p>
                ) : null}
                {l.summary ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{l.summary}</p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}

      <NovoLeadDialog open={novoAberto} onOpenChange={setNovoAberto} />
    </>
  );
}

function NovoLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const invalidate = useCrmInvalidate();
  const { data: statuses } = useCrmCatalog(CRM_STATUS_KIND);
  const { data: servicos } = useCrmCatalog(CRM_SERVICE_KIND);
  const { data: campanhas } = useCrmCampaigns();
  const { data: vendedoras } = useSalespeople();
  const { data: origens } = useConfigOptions("sales_origin");

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [estofado, setEstofado] = useState("");
  const [servico, setServico] = useState("");
  const [temperatura, setTemperatura] = useState("FRIO");
  const [statusId, setStatusId] = useState("");
  const [resumo, setResumo] = useState("");
  const [vendedoraId, setVendedoraId] = useState("");
  const [origemId, setOrigemId] = useState("");
  const [campanhaId, setCampanhaId] = useState("");
  const [data, setData] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function verificarDuplicado(valor: string) {
    const normalized = normalizePhone(valor);
    if (!normalized) {
      setAviso(null);
      return;
    }
    const { data: abertos } = await supabase
      .from("crm_leads")
      .select("id, lead_name, is_open")
      .eq("normalized_phone", normalized)
      .eq("is_open", true)
      .limit(1);
    setAviso(
      abertos && abertos.length > 0
        ? "Este telefone já tem uma oportunidade em aberto. Ao salvar, será criada uma nova oportunidade para o mesmo contato."
        : null,
    );
  }

  async function salvar() {
    if (!nome.trim()) {
      toast.error("Informe o nome do lead.");
      return;
    }
    if (normalizePhone(telefone).length < 12) {
      toast.error("Informe um telefone válido com DDD.");
      return;
    }
    setSalvando(true);
    try {
      await createLead({
        name: nome.trim().slice(0, 120),
        phone: telefone.trim(),
        upholstery: estofado.trim().slice(0, 500) || undefined,
        serviceInterest: servico || undefined,
        temperature: temperatura === "QUENTE" ? "QUENTE" : "FRIO",
        statusId: statusId || (statuses?.[0]?.id ?? null),
        summary: resumo.trim().slice(0, 2000) || undefined,
        salespersonId: vendedoraId || null,
        originId: origemId || null,
        campaignId: campanhaId || null,
        firstContactDate: data,
      });
      toast.success("Lead cadastrado.");
      invalidate();
      onOpenChange(false);
      setNome("");
      setTelefone("");
      setEstofado("");
      setResumo("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cadastrar o lead.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
          <DialogDescription>
            Cadastro manual. O contato é reaproveitado quando o telefone já existe.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="n-nome">Nome</Label>
            <Input id="n-nome" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="n-tel">Telefone com DDD</Label>
            <Input
              id="n-tel"
              value={telefone}
              maxLength={20}
              onChange={(e) => setTelefone(e.target.value)}
              onBlur={(e) => void verificarDuplicado(e.target.value)}
              placeholder="(11) 99999-9999"
            />
            {aviso ? <p className="text-xs text-amber-700">{aviso}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="n-data">Data do primeiro contato</Label>
            <Input id="n-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="n-estofado">Estofado</Label>
            <Input
              id="n-estofado"
              value={estofado}
              maxLength={500}
              onChange={(e) => setEstofado(e.target.value)}
              placeholder="Sofá 3 lugares, 2 poltronas..."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="n-serv">Serviço de interesse</Label>
              <NativeSelect
                id="n-serv"
                value={servico}
                onChange={setServico}
                options={(servicos ?? []).map((s) => ({ value: s.name, label: s.name }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="n-temp">Temperatura</Label>
              <NativeSelect
                id="n-temp"
                placeholder="Frio"
                value={temperatura}
                onChange={setTemperatura}
                options={[
                  { value: "FRIO", label: "Frio" },
                  { value: "QUENTE", label: "Quente" },
                ]}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="n-status">Status</Label>
              <NativeSelect
                id="n-status"
                value={statusId}
                onChange={setStatusId}
                options={(statuses ?? []).map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="n-vend">Vendedora</Label>
              <NativeSelect
                id="n-vend"
                value={vendedoraId}
                onChange={setVendedoraId}
                options={(vendedoras ?? []).map((v) => ({ value: v.id, label: v.name }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="n-origem">Origem</Label>
              <NativeSelect
                id="n-origem"
                value={origemId}
                onChange={setOrigemId}
                options={(origens ?? []).map((o) => ({ value: o.id, label: o.name }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="n-camp">Campanha</Label>
              <NativeSelect
                id="n-camp"
                value={campanhaId}
                onChange={setCampanhaId}
                options={(campanhas ?? []).map((c) => ({ value: c.id, label: c.campaign_name }))}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="n-resumo">Resumo da conversa</Label>
            <Textarea
              id="n-resumo"
              value={resumo}
              maxLength={2000}
              rows={3}
              onChange={(e) => setResumo(e.target.value)}
            />
          </div>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Cadastrar lead"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
