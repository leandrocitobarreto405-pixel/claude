import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Edit, Link2, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, SectionCard } from "@/components/app-shell";
import { NativeSelect } from "@/components/crm-ui";
import {
  createSourceIntegration,
  deleteSourceIntegration,
  getCampaignsForIntegration,
  getSalespeopleForIntegration,
  listSourceIntegrations,
  simulateSourceIntegration,
  updateSourceIntegration,
} from "@/lib/crm-source.functions";
import { cn } from "@/lib/utils";

const SOURCE_OPTIONS = [
  { value: "meta_lead_ads", label: "Meta Lead Ads" },
  { value: "google_ads", label: "Google Ads (formulários)" },
  { value: "custom_form", label: "Formulário próprio do site" },
];

const DEFAULT_MAPPINGS: Record<string, Record<string, string>> = {
  meta_lead_ads: {
    name: "full_name",
    phone: "phone_number",
    email: "email",
    city: "city",
    service: "service",
    message: "message",
  },
  google_ads: {
    name: "FULL_NAME",
    phone: "PHONE_NUMBER",
    email: "EMAIL",
    city: "CITY",
    service: "SERVICE",
    message: "",
  },
  custom_form: {
    name: "nome",
    phone: "telefone",
    email: "email",
    city: "cidade",
    service: "servico",
    message: "mensagem",
  },
};

export const Route = createFileRoute("/_authenticated/crm/integracoes")({
  head: () => ({
    meta: [
      { title: "Integrações de Leads — Nexa OS" },
      {
        name: "description",
        content:
          "Conecte Meta, Google Ads e formulários próprios para criar leads automaticamente no CRM.",
      },
      { property: "og:title", content: "Integrações de Leads — Nexa OS" },
      {
        property: "og:description",
        content:
          "Conecte Meta, Google Ads e formulários próprios para criar leads automaticamente no CRM.",
      },
    ],
  }),
  component: LeadIntegrations,
});

type IntegrationItem = {
  id: string;
  name: string;
  source_type: string;
  webhook_token: string;
  secret: string | null;
  field_mapping: Record<string, string>;
  default_campaign_id: string | null;
  default_salesperson_id: string | null;
  active: boolean;
};

function LeadIntegrations() {
  const listar = useServerFn(listSourceIntegrations);
  const criar = useServerFn(createSourceIntegration);
  const atualizar = useServerFn(updateSourceIntegration);
  const excluir = useServerFn(deleteSourceIntegration);
  const simular = useServerFn(simulateSourceIntegration);
  const listarCampanhas = useServerFn(getCampaignsForIntegration);
  const listarVendedores = useServerFn(getSalespeopleForIntegration);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IntegrationItem | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testSource, setTestSource] = useState("meta_lead_ads");
  const [testPayload, setTestPayload] = useState("");

  const integrations = useQuery({
    queryKey: ["crm_source_integrations"],
    queryFn: () => listar({}),
  });
  const campaigns = useQuery({
    queryKey: ["crm_campaigns_select"],
    queryFn: () => listarCampanhas({}),
  });
  const salespeople = useQuery({
    queryKey: ["salespeople_select"],
    queryFn: () => listarVendedores({}),
  });

  const items = (integrations.data ?? []) as IntegrationItem[];
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("URL copiada.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  function abrirCriar() {
    setEditing(null);
    setDialogOpen(true);
  }

  function abrirEditar(item: IntegrationItem) {
    setEditing(item);
    setDialogOpen(true);
  }

  async function handleSalvar(formData: FormData) {
    const sourceType = String(formData.get("source_type"));
    const fieldMapping: Record<string, string> = {};
    for (const key of ["name", "phone", "email", "city", "service", "message"]) {
      const value = String(formData.get(`map_${key}`) ?? "");
      if (value) fieldMapping[key] = value;
    }

    const payload = {
      id: editing?.id,
      name: String(formData.get("name")),
      source_type: sourceType,
      webhook_token: String(formData.get("webhook_token")),
      secret: String(formData.get("secret") || ""),
      field_mapping: fieldMapping,
      default_campaign_id: String(formData.get("default_campaign_id") || ""),
      default_salesperson_id: String(formData.get("default_salesperson_id") || ""),
      active: formData.get("active") === "on",
    };

    try {
      if (editing?.id) {
        await atualizar({ data: payload });
        toast.success("Integração atualizada.");
      } else {
        await criar({ data: payload });
        toast.success("Integração criada.");
      }
      setDialogOpen(false);
      void integrations.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    }
  }

  async function handleExcluir(id: string) {
    if (!confirm("Excluir esta integração?")) return;
    try {
      await excluir({ data: { id } });
      toast.success("Integração excluída.");
      void integrations.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir.");
    }
  }

  async function handleTestar() {
    try {
      const payload = JSON.parse(testPayload || "{}");
      const r = await simular({ data: { source_type: testSource, payload } });
      toast.success(
        r.result.created
          ? `Lead criado: ${r.mapped.name} (${r.mapped.phone})`
          : r.result.duplicate
            ? `Lead já existente vinculado: ${r.result.leadId}`
            : `Processado: ${r.mapped.name} (${r.mapped.phone})`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no teste.");
    }
  }

  function defaultNameFor(key: string, sourceType: string, editingMapping: Record<string, string>) {
    return editingMapping[key] ?? DEFAULT_MAPPINGS[sourceType]?.[key] ?? "";
  }

  return (
    <>
      <PageHeader
        title="Integrações de Leads"
        description="Conecte Meta Lead Ads, Google Ads e formulários do site para criar leads automaticamente no CRM."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void integrations.refetch()} className="gap-2">
              <RefreshCw className="size-4" /> Atualizar
            </Button>
            <Button onClick={abrirCriar} className="gap-2">
              <Plus className="size-4" /> Nova integração
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Webhook genérico"
          description="Endpoint para receber leads de qualquer fonte."
          className="lg:col-span-2"
        >
          <div className="flex gap-2">
            <Input
              readOnly
              value={`${baseUrl}/api/public/hooks/leads/{tipo}/{token}`}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar URL"
              onClick={() => copiar(`${baseUrl}/api/public/hooks/leads/{tipo}/{token}`)}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Substitua <span className="font-mono">{"{tipo}"}</span> por{" "}
            <span className="font-mono">meta_lead_ads</span>,{" "}
            <span className="font-mono">google_ads</span> ou{" "}
            <span className="font-mono">custom_form</span> e{" "}
            <span className="font-mono">{"{token}"}</span> pelo token cadastrado na integração.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setTestDialogOpen(true)} className="gap-2">
              <Webhook className="size-4" /> Testar payload
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Segurança" description="Como proteger as chamadas recebidas.">
          <ul className="grid gap-2 text-xs text-muted-foreground">
            <li className="flex gap-2">
              <span className="text-primary">•</span>
              Meta e Google Ads validam assinatura HMAC-SHA256 quando um segredo é informado.
            </li>
            <li className="flex gap-2">
              <span className="text-primary">•</span>
              Formulários próprios usam o segredo como token Bearer no cabeçalho{" "}
              <span className="font-mono">Authorization</span>.
            </li>
            <li className="flex gap-2">
              <span className="text-primary">•</span>O token no path é único por integração e pode
              ser revogado a qualquer momento.
            </li>
          </ul>
        </SectionCard>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-navy">Integrações cadastradas</h2>
      <div className="mt-4 grid gap-4">
        {!items.length && !integrations.isLoading ? (
          <SectionCard
            title="Nenhuma integração"
            description="Cadastre sua primeira fonte de leads."
          >
            <Button onClick={abrirCriar} className="gap-2">
              <Plus className="size-4" /> Nova integração
            </Button>
          </SectionCard>
        ) : null}
        {items.map((item) => {
          const source = SOURCE_OPTIONS.find((s) => s.value === item.source_type);
          const url = `${baseUrl}/api/public/hooks/leads/${item.source_type}/${item.webhook_token}`;
          const campaignName = campaigns.data?.find(
            (c) => c.id === item.default_campaign_id,
          )?.campaign_name;
          const salespersonName = salespeople.data?.find(
            (s) => s.id === item.default_salesperson_id,
          )?.name;
          return (
            <SectionCard
              key={item.id}
              title={item.name}
              description={source?.label ?? item.source_type}
              className={cn(!item.active && "opacity-75")}
              actions={
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Editar"
                    onClick={() => abrirEditar(item)}
                  >
                    <Edit className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Excluir"
                    onClick={() => handleExcluir(item.id)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              }
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Link2 className="size-4 text-primary" />
                    <span className="break-all font-mono text-xs text-muted-foreground">{url}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md border px-2 py-1">
                      Campanha padrão: {campaignName ?? "—"}
                    </span>
                    <span className="rounded-md border px-2 py-1">
                      Vendedor padrão: {salespersonName ?? "—"}
                    </span>
                    <span className="rounded-md border px-2 py-1">
                      Segredo: {item.secret ? "Configurado" : "Não configurado"}
                    </span>
                  </div>
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Mapeamento de campos</p>
                  <div className="grid grid-cols-2 gap-1">
                    {Object.entries(item.field_mapping).map(([k, v]) => (
                      <div key={k} className="flex gap-1">
                        <span className="font-medium text-foreground">{k}:</span>
                        <span>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar integração" : "Nova integração de leads"}</DialogTitle>
            <DialogDescription>
              Configure a fonte externa, o token de acesso e o mapeamento de campos.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSalvar(new FormData(e.currentTarget));
            }}
            className="grid gap-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="name">Nome da integração</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={editing?.name ?? ""}
                  required
                  maxLength={120}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="source_type">Tipo de fonte</Label>
                <NativeSelect
                  id="source_type"
                  value={editing?.source_type ?? "meta_lead_ads"}
                  onChange={(v) => {
                    const input = document.getElementById("source_type_input") as HTMLInputElement;
                    if (input) input.value = v;
                  }}
                  options={SOURCE_OPTIONS}
                />
                <input
                  id="source_type_input"
                  type="hidden"
                  name="source_type"
                  value={editing?.source_type ?? "meta_lead_ads"}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="webhook_token">Token do webhook (parte da URL)</Label>
                <Input
                  id="webhook_token"
                  name="webhook_token"
                  defaultValue={editing?.webhook_token ?? ""}
                  required
                  minLength={8}
                  maxLength={120}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="secret">Segredo para validação (opcional)</Label>
                <Input
                  id="secret"
                  name="secret"
                  defaultValue={editing?.secret ?? ""}
                  maxLength={500}
                  placeholder="HMAC ou Bearer token"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="default_campaign_id">Campanha padrão</Label>
                <NativeSelect
                  id="default_campaign_id"
                  value={editing?.default_campaign_id ?? ""}
                  onChange={(v) => {
                    const input = document.getElementById(
                      "default_campaign_id_input",
                    ) as HTMLInputElement;
                    if (input) input.value = v;
                  }}
                  options={[
                    { value: "", label: "Nenhuma" },
                    ...(campaigns.data?.map((c) => ({ value: c.id, label: c.campaign_name })) ??
                      []),
                  ]}
                />
                <input
                  id="default_campaign_id_input"
                  type="hidden"
                  name="default_campaign_id"
                  value={editing?.default_campaign_id ?? ""}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="default_salesperson_id">Vendedor padrão</Label>
                <NativeSelect
                  id="default_salesperson_id"
                  value={editing?.default_salesperson_id ?? ""}
                  onChange={(v) => {
                    const input = document.getElementById(
                      "default_salesperson_id_input",
                    ) as HTMLInputElement;
                    if (input) input.value = v;
                  }}
                  options={[
                    { value: "", label: "Nenhum" },
                    ...(salespeople.data?.map((s) => ({ value: s.id, label: s.name })) ?? []),
                  ]}
                />
                <input
                  id="default_salesperson_id_input"
                  type="hidden"
                  name="default_salesperson_id"
                  value={editing?.default_salesperson_id ?? ""}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                { key: "name", label: "Nome" },
                { key: "phone", label: "Telefone" },
                { key: "email", label: "E-mail" },
                { key: "city", label: "Cidade" },
                { key: "service", label: "Serviço" },
                { key: "message", label: "Mensagem" },
              ].map(({ key, label }) => (
                <div key={key} className="grid gap-1.5">
                  <Label htmlFor={`map_${key}`}>Campo: {label}</Label>
                  <Input
                    id={`map_${key}`}
                    name={`map_${key}`}
                    defaultValue={defaultNameFor(
                      key,
                      editing?.source_type ?? "meta_lead_ads",
                      editing?.field_mapping ?? {},
                    )}
                    placeholder={key === "phone" ? "obrigatório" : "nome no JSON"}
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Switch id="active" name="active" defaultChecked={editing?.active !== false} />
              <Label htmlFor="active" className="cursor-pointer">
                Integração ativa
              </Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">{editing ? "Salvar" : "Criar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Testar payload de lead</DialogTitle>
            <DialogDescription>
              Cole um JSON real de exemplo para simular a criação de um lead.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="test_source">Tipo de fonte</Label>
              <NativeSelect
                id="test_source"
                value={testSource}
                onChange={setTestSource}
                options={SOURCE_OPTIONS}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="test_payload">Payload JSON</Label>
              <Textarea
                id="test_payload"
                value={testPayload}
                onChange={(e) => setTestPayload(e.target.value)}
                rows={10}
                placeholder='{"entry": [{"changes": [{"value": {"lead": {"leadgen_id": "123", "field_data": [{"name": "full_name", "values": ["João Silva"]}, {"name": "phone_number", "values": ["11999999999"]}]}}}]}}'
                className="font-mono text-xs"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleTestar}>Simular recebimento</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
