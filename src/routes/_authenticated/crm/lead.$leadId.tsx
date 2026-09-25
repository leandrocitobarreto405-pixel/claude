import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CalendarClock, ClipboardPlus, MessageCircle, Sparkles } from "lucide-react";
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
import { PageHeader, SectionCard } from "@/components/app-shell";
import { NativeSelect, StatusPill, TemperatureBadge } from "@/components/crm-ui";
import { supabase } from "@/integrations/supabase/client";
import { useConfigOptions, useSalespeople } from "@/lib/data";
import {
  CRM_LOSS_KIND,
  CRM_RESULT_KIND,
  CRM_SERVICE_KIND,
  CRM_STATUS_KIND,
  changeLeadStatus,
  completeFollowup,
  createLead,
  DEFAULT_FOLLOWUP_HOURS,
  formatPhoneBR,
  normalizePhone,
  scheduleFollowup,
  statusMeta,
  suggestFollowupAt,
  updateLead,
  useCrmCampaigns,
  useCrmCatalog,
  useCrmInvalidate,
  useCrmLead,
  useLeadTimeline,
} from "@/lib/crm";
import { brl, dateBR, dateTimeBR, whatsappLink } from "@/lib/format";
import { sugerirResumoDoLead } from "@/lib/crm-ai.functions";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_authenticated/crm/lead/$leadId")({
  head: () => ({
    meta: [
      { title: "Lead do CRM — Nexa OS" },
      {
        name: "description",
        content: "Histórico completo do lead: conversas, status, repescagens e conversão em OS.",
      },
      { property: "og:title", content: "Lead do CRM — Nexa OS" },
      {
        property: "og:description",
        content: "Histórico completo do lead: conversas, status, repescagens e conversão em OS.",
      },
    ],
  }),
  component: LeadDetalhe,
});

const MODELOS_MENSAGEM = [
  {
    label: "Primeiro contato",
    text: "Olá {{nome}}! Aqui é da Turbine Clean. Vi seu contato sobre a higienização do seu estofado. Pode me contar quais peças você quer higienizar?",
  },
  {
    label: "Orçamento enviado",
    text: "Olá {{nome}}! Enviei o orçamento do seu estofado. Ficou alguma dúvida? Posso reservar uma data para você.",
  },
  {
    label: "Repescagem",
    text: "Oi {{nome}}, tudo bem? Passando para saber se você ainda tem interesse na higienização. Consigo encaixar você nesta semana.",
  },
  {
    label: "Confirmação de agendamento",
    text: "Oi {{nome}}! Confirmando seu atendimento. Assim que fechar a data eu te envio todos os detalhes por aqui.",
  },
];

function LeadDetalhe() {
  const { leadId } = Route.useParams();
  const navigate = useNavigate();
  const invalidate = useCrmInvalidate();
  const sugerirResumo = useServerFn(sugerirResumoDoLead);

  const leadQuery = useCrmLead(leadId);
  const lead = leadQuery.data;
  const timeline = useLeadTimeline(leadId, lead?.whatsapp_contact_id ?? null);

  const { data: statuses } = useCrmCatalog(CRM_STATUS_KIND);
  const { data: resultados } = useCrmCatalog(CRM_RESULT_KIND);
  const { data: motivosPerda } = useCrmCatalog(CRM_LOSS_KIND);
  const { data: servicos } = useCrmCatalog(CRM_SERVICE_KIND);
  const { data: vendedoras } = useSalespeople();
  const { data: origens } = useConfigOptions("sales_origin");
  const { data: campanhas } = useCrmCampaigns();

  const [statusDialog, setStatusDialog] = useState<string | null>(null);
  const [motivoPerda, setMotivoPerda] = useState("");
  const [obsStatus, setObsStatus] = useState("");
  const [modelo, setModelo] = useState(MODELOS_MENSAGEM[0]!.text);
  const [gerandoIA, setGerandoIA] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const historicoOs = useQuery({
    queryKey: ["crm_lead_os", lead?.normalized_phone, lead?.customer_id],
    enabled: Boolean(lead),
    queryFn: async () => {
      if (!lead) return [];
      let customerId = lead.customer_id;
      if (!customerId && lead.normalized_phone) {
        const local = lead.normalized_phone.startsWith("55")
          ? lead.normalized_phone.slice(2)
          : lead.normalized_phone;
        const { data: cust } = await supabase
          .from("customers")
          .select("id, phone")
          .or(`phone.eq.${lead.normalized_phone},phone.eq.${local}`)
          .maybeSingle();
        customerId = cust?.id ?? null;
      }
      if (!customerId) return [];
      const { data } = await supabase
        .from("work_orders")
        .select("id, os_number, sale_date, status, total_gross_value")
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .order("sale_date", { ascending: false });
      return data ?? [];
    },
  });

  const eventos = useMemo(() => {
    const t = timeline.data;
    if (!t) return [];
    const items: { at: string; kind: string; title: string; detail?: string | undefined }[] = [];
    for (const m of t.messages) {
      items.push({
        at: m.message_timestamp,
        kind: m.direction === "Recebida" ? "Mensagem recebida" : "Mensagem enviada",
        title: m.text_content ?? `(${m.message_type})`,
        detail: m.referral_headline ? `Anúncio: ${m.referral_headline}` : undefined,
      });
    }
    for (const h of t.history) {
      items.push({
        at: h.changed_at,
        kind: "Status",
        title: `${h.previous_status_name ?? "—"} → ${h.new_status_name ?? "—"}`,
        detail: [h.change_source, h.notes].filter(Boolean).join(" · "),
      });
    }
    for (const f of t.followups) {
      items.push({
        at: f.completed_at ?? f.scheduled_at,
        kind: f.completed_at ? "Repescagem realizada" : "Repescagem agendada",
        title: f.result ?? "Aguardando contato",
        detail: f.notes ?? undefined,
      });
    }
    return items.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [timeline.data]);

  if (leadQuery.isLoading)
    return <p className="text-sm text-muted-foreground">Carregando lead...</p>;
  if (!lead)
    return (
      <SectionCard title="Lead não encontrado" accent="danger">
        <Button variant="outline" asChild>
          <Link to="/crm/leads">Voltar para os leads</Link>
        </Button>
      </SectionCard>
    );

  const meta = statusMeta(lead.status);
  const mensagemPronta = modelo.replace(
    /\{\{nome\}\}/g,
    (lead.lead_name || "").split(" ")[0] ?? "",
  );
  const linkWhats = whatsappLink(lead.phone, mensagemPronta);

  async function aplicarStatus(statusId: string) {
    const status = (statuses ?? []).find((s) => s.id === statusId);
    if (!status) return;
    const info = statusMeta(status);
    if (info.lost && !motivoPerda) {
      setStatusDialog(statusId);
      return;
    }
    try {
      await changeLeadStatus(lead!, status, {
        notes: obsStatus.trim().slice(0, 500) || undefined,
        lossReasonId: info.lost ? motivoPerda : null,
      });
      toast.success(`Status alterado para "${status.name}".`);
      setStatusDialog(null);
      setMotivoPerda("");
      setObsStatus("");
      invalidate();
      void leadQuery.refetch();
      void timeline.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar o status.");
    }
  }

  async function salvarCampos(patch: Record<string, unknown>) {
    setSalvando(true);
    try {
      await updateLead(lead!.id, patch);
      invalidate();
      void leadQuery.refetch();
    } catch {
      toast.error("Não foi possível salvar a alteração.");
    } finally {
      setSalvando(false);
    }
  }

  async function agendarRepescagem(hours: number) {
    try {
      await scheduleFollowup(lead!.id, suggestFollowupAt(hours));
      toast.success(`Repescagem agendada para ${hours}h.`);
      invalidate();
      void timeline.refetch();
      void leadQuery.refetch();
    } catch {
      toast.error("Não foi possível agendar a repescagem.");
    }
  }

  async function registrarRetorno(followupId: string, resultado: string) {
    try {
      await completeFollowup(followupId, lead!.id, resultado);
      toast.success("Retorno registrado.");
      invalidate();
      void timeline.refetch();
      void leadQuery.refetch();
    } catch {
      toast.error("Não foi possível registrar o retorno.");
    }
  }

  async function novaOportunidade() {
    try {
      const id = await createLead({
        name: lead!.lead_name,
        phone: lead!.phone,
        serviceInterest: lead!.service_interest ?? undefined,
        statusId: statuses?.[0]?.id ?? null,
        salespersonId: lead!.salesperson_id,
        originId: lead!.sales_origin_id,
        contactId: lead!.whatsapp_contact_id,
      });
      toast.success("Nova oportunidade criada para o mesmo contato.");
      invalidate();
      void navigate({ to: "/crm/lead/$leadId", params: { leadId: id } });
    } catch {
      toast.error("Não foi possível criar a nova oportunidade.");
    }
  }

  async function gerarResumoIA() {
    setGerandoIA(true);
    try {
      const r = await sugerirResumo({ data: { leadId: lead!.id } });
      toast.success("Sugestão da IA aplicada. Revise e ajuste se precisar.");
      invalidate();
      void leadQuery.refetch();
      if (r.temperature) {
        toast.info(
          `Temperatura sugerida pela IA: ${r.temperature === "QUENTE" ? "Quente" : "Frio"}.`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar a sugestão.");
    } finally {
      setGerandoIA(false);
    }
  }

  const repescagensPendentes = (timeline.data?.followups ?? []).filter(
    (f) => f.status === "Pendente",
  );

  return (
    <>
      <PageHeader
        title={lead.lead_name || "Sem nome"}
        description={`${formatPhoneBR(lead.phone)} · primeiro contato em ${dateBR(lead.first_contact_date)}`}
        actions={
          <>
            <Button variant="outline" asChild className="gap-2">
              <Link to="/crm/leads">
                <ArrowLeft className="size-4" /> Voltar
              </Link>
            </Button>
            {linkWhats ? (
              <Button variant="outline" asChild className="gap-2">
                <a href={linkWhats} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" /> Abrir WhatsApp
                </a>
              </Button>
            ) : null}
            {lead.linked_work_order_id && lead.work_order ? (
              <Button asChild className="gap-2">
                <Link to="/os/$osNumber" params={{ osNumber: lead.work_order.os_number }}>
                  Ver OS {lead.work_order.os_number}
                </Link>
              </Button>
            ) : (
              <Button asChild className="gap-2">
                <Link to="/nova-os" search={{ lead: lead.id }}>
                  <ClipboardPlus className="size-4" /> Converter em OS
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 lg:col-span-2">
          <SectionCard title="Dados comerciais" accent="navy">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusPill status={lead.status} />
              <TemperatureBadge
                temperature={lead.temperature}
                suggested={!lead.temperature_confirmed}
              />
              {lead.work_order ? (
                <span className="text-xs text-muted-foreground">
                  Convertido em OS {lead.work_order.os_number} ·{" "}
                  {brl(lead.work_order.total_gross_value)}
                </span>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="d-nome">Nome</Label>
                <Input
                  id="d-nome"
                  defaultValue={lead.lead_name}
                  maxLength={120}
                  onBlur={(e) => void salvarCampos({ lead_name: e.target.value.slice(0, 120) })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="d-tel">Telefone</Label>
                <Input
                  id="d-tel"
                  defaultValue={lead.phone}
                  maxLength={20}
                  onBlur={(e) =>
                    void salvarCampos({
                      phone: e.target.value.slice(0, 20),
                      normalized_phone: normalizePhone(e.target.value) || null,
                    })
                  }
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="d-estofado">Estofado</Label>
                <Input
                  id="d-estofado"
                  defaultValue={lead.upholstery_description ?? ""}
                  maxLength={500}
                  onBlur={(e) =>
                    void salvarCampos({ upholstery_description: e.target.value.slice(0, 500) })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="d-serv">Serviço de interesse</Label>
                <NativeSelect
                  id="d-serv"
                  value={lead.service_interest ?? ""}
                  onChange={(v) => void salvarCampos({ service_interest: v || null })}
                  options={(servicos ?? []).map((s) => ({ value: s.name, label: s.name }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="d-temp">Temperatura</Label>
                <NativeSelect
                  id="d-temp"
                  placeholder="Frio"
                  value={lead.temperature}
                  onChange={(v) =>
                    void salvarCampos({ temperature: v || "FRIO", temperature_confirmed: true })
                  }
                  options={[
                    { value: "FRIO", label: "Frio" },
                    { value: "QUENTE", label: "Quente" },
                  ]}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="d-vend">Vendedora</Label>
                <NativeSelect
                  id="d-vend"
                  value={lead.salesperson_id ?? ""}
                  onChange={(v) => void salvarCampos({ salesperson_id: v || null })}
                  options={(vendedoras ?? []).map((v) => ({ value: v.id, label: v.name }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="d-origem">Origem</Label>
                <NativeSelect
                  id="d-origem"
                  value={lead.sales_origin_id ?? ""}
                  onChange={(v) => void salvarCampos({ sales_origin_id: v || null })}
                  options={(origens ?? []).map((o) => ({ value: o.id, label: o.name }))}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="d-camp">Campanha</Label>
                <NativeSelect
                  id="d-camp"
                  placeholder={lead.ad_id ? "Campanha não identificada" : "Sem campanha"}
                  value={lead.campaign_id ?? ""}
                  onChange={(v) => void salvarCampos({ campaign_id: v || null })}
                  options={(campanhas ?? []).map((c) => ({ value: c.id, label: c.campaign_name }))}
                />
                {lead.ad_id && !lead.campaign_id ? (
                  <p className="text-xs text-amber-700">
                    Anúncio {lead.ad_id} sem campanha cadastrada. Cadastre em Campanhas para medir
                    custo e retorno.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="d-resumo">Resumo da conversa</Label>
                <Textarea
                  id="d-resumo"
                  defaultValue={lead.summary ?? ""}
                  maxLength={2000}
                  rows={4}
                  onBlur={(e) =>
                    void salvarCampos({
                      summary: e.target.value.slice(0, 2000),
                      summary_source: "Manual",
                    })
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={gerarResumoIA}
                    disabled={gerandoIA}
                  >
                    <Sparkles className="size-4" />
                    {gerandoIA ? "Gerando..." : "Sugerir resumo com IA"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {lead.summary_source === "IA"
                      ? "Resumo sugerido pela IA — revise"
                      : `Origem: ${lead.summary_source}`}
                  </span>
                </div>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="d-obs">Observações internas</Label>
                <Textarea
                  id="d-obs"
                  defaultValue={lead.notes ?? ""}
                  maxLength={2000}
                  rows={3}
                  onBlur={(e) => void salvarCampos({ notes: e.target.value.slice(0, 2000) })}
                />
              </div>
            </div>
            {salvando ? <p className="mt-2 text-xs text-muted-foreground">Salvando...</p> : null}
          </SectionCard>

          <SectionCard
            title="Linha do tempo"
            description="Mensagens, status, repescagens e conversão."
          >
            {eventos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>
            ) : (
              <ol className="grid gap-3">
                {eventos.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="border-l-2 border-primary/30 pl-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {e.kind} · {dateTimeBR(e.at)}
                    </p>
                    <p className="text-sm text-navy">{e.title}</p>
                    {e.detail ? <p className="text-xs text-muted-foreground">{e.detail}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>

        <div className="grid gap-4">
          <SectionCard title="Ações rápidas">
            <div className="grid gap-2">
              <Label htmlFor="a-status">Mudar status</Label>
              <NativeSelect
                id="a-status"
                placeholder="Selecione o novo status"
                value=""
                onChange={(v) => void aplicarStatus(v)}
                options={(statuses ?? []).map((s) => ({ value: s.id, label: s.name }))}
              />
              <div className="mt-2 grid gap-2">
                {DEFAULT_FOLLOWUP_HOURS.map((h) => (
                  <Button
                    key={h}
                    variant="outline"
                    className="gap-2"
                    onClick={() => void agendarRepescagem(h)}
                  >
                    <CalendarClock className="size-4" /> Repescar em {h}h
                  </Button>
                ))}
                <Button variant="outline" onClick={novaOportunidade}>
                  Nova oportunidade para este contato
                </Button>
              </div>
              {meta.closed ? (
                <p className="text-xs text-muted-foreground">
                  Oportunidade encerrada em {lead.closed_at ? dateTimeBR(lead.closed_at) : "—"}. O
                  histórico permanece salvo.
                </p>
              ) : null}
            </div>
          </SectionCard>

          {repescagensPendentes.length > 0 ? (
            <SectionCard title="Repescagens pendentes" accent="warning">
              <div className="grid gap-3">
                {repescagensPendentes.map((f) => (
                  <div key={f.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium text-navy">{dateTimeBR(f.scheduled_at)}</p>
                    <Label className="mt-2 block text-xs">O que aconteceu?</Label>
                    <NativeSelect
                      placeholder="Registrar resultado"
                      value=""
                      onChange={(v) => void registrarRetorno(f.id, v)}
                      options={(resultados ?? []).map((r) => ({ value: r.name, label: r.name }))}
                    />
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard title="Mensagem no WhatsApp" description="Envio sempre manual, por você.">
            <div className="grid gap-2">
              <NativeSelect
                placeholder="Escolher modelo"
                value=""
                onChange={(v) => setModelo(v)}
                options={MODELOS_MENSAGEM.map((m) => ({ value: m.text, label: m.label }))}
              />
              <Textarea
                value={modelo}
                rows={5}
                maxLength={1000}
                onChange={(e) => setModelo(e.target.value)}
              />
              {linkWhats ? (
                <Button asChild className="gap-2">
                  <a href={linkWhats} target="_blank" rel="noreferrer">
                    <MessageCircle className="size-4" /> Abrir conversa com esta mensagem
                  </a>
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Telefone inválido para abrir o WhatsApp.
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Histórico do cliente">
            {(historicoOs.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma OS anterior para este telefone.
              </p>
            ) : (
              <>
                <p className="mb-2 text-sm text-navy">
                  Cliente existente — possui {historicoOs.data!.length} ordem(ns) de serviço
                  anterior(es).
                </p>
                <ul className="grid gap-2 text-sm">
                  {historicoOs.data!.map((os) => (
                    <li key={os.id} className="flex items-center justify-between gap-2">
                      <Link
                        to="/os/$osNumber"
                        params={{ osNumber: os.os_number }}
                        className="text-primary hover:underline"
                      >
                        OS {os.os_number}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {dateBR(os.sale_date)} · {brl(os.total_gross_value)} · {os.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </SectionCard>
        </div>
      </div>

      <Dialog open={Boolean(statusDialog)} onOpenChange={(v) => !v && setStatusDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar desistência</DialogTitle>
            <DialogDescription>
              Informe o motivo para manter o histórico completo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-motivo">Motivo</Label>
              <NativeSelect
                id="p-motivo"
                value={motivoPerda}
                onChange={setMotivoPerda}
                options={(motivosPerda ?? []).map((m) => ({ value: m.id, label: m.name }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-obs">Observações</Label>
              <Textarea
                id="p-obs"
                value={obsStatus}
                maxLength={500}
                rows={3}
                onChange={(e) => setObsStatus(e.target.value)}
              />
            </div>
            <Button
              disabled={!motivoPerda}
              onClick={() => statusDialog && void aplicarStatus(statusDialog)}
            >
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
