import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { onlyDigits, todayISO } from "@/lib/format";

/* ============================ Telefone ============================ */

/** Normaliza um telefone para deduplicação: só dígitos, sempre com DDI. */
export function normalizePhone(input: string | null | undefined): string {
  const digits = onlyDigits(String(input ?? ""));
  if (!digits) return "";
  if (digits.length <= 11) return `55${digits}`;
  return digits;
}

/** Exibe (11) 99999-9999 quando possível, mantendo o original caso contrário. */
export function formatPhoneBR(input: string | null | undefined): string {
  const digits = onlyDigits(String(input ?? ""));
  if (!digits) return "—";
  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return String(input ?? "");
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return Boolean(na) && na === nb;
}

/* ============================ Tipos ============================ */

export type CrmTemperature = "FRIO" | "QUENTE";

export type CrmStatus = {
  id: string;
  name: string;
  active: boolean;
  display_order: number;
  metadata: Record<string, unknown> | null;
};

export type CrmLead = {
  id: string;
  whatsapp_contact_id: string | null;
  customer_id: string | null;
  first_contact_date: string;
  lead_name: string;
  phone: string;
  normalized_phone: string | null;
  upholstery_description: string | null;
  service_interest: string | null;
  temperature: string;
  temperature_score: number | null;
  temperature_confirmed: boolean;
  status_id: string | null;
  summary: string | null;
  summary_source: string;
  last_follow_up_at: string | null;
  follow_up_result: string | null;
  next_follow_up_at: string | null;
  salesperson_id: string | null;
  sales_origin_id: string | null;
  campaign_id: string | null;
  ad_id: string | null;
  source_type: string | null;
  loss_reason_id: string | null;
  linked_work_order_id: string | null;
  is_open: boolean;
  last_interaction_at: string | null;
  notes: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmLeadRow = CrmLead & {
  status: { id: string; name: string; metadata: Record<string, unknown> | null } | null;
  campaign: { id: string; campaign_name: string; platform: string } | null;
  salesperson: { id: string; name: string } | null;
  origem: { id: string; name: string } | null;
  contact: {
    id: string;
    normalized_phone: string;
    profile_name: string | null;
    total_inbound_messages: number;
    last_message_at: string | null;
  } | null;
  work_order: { id: string; os_number: string; status: string; total_gross_value: number } | null;
};

export type CrmCampaign = {
  id: string;
  platform: string;
  campaign_name: string;
  campaign_external_id: string | null;
  ad_set_name: string | null;
  ad_name: string | null;
  ad_external_id: string | null;
  advertised_service: string | null;
  active: boolean;
};

export type CrmFollowup = {
  id: string;
  crm_lead_id: string;
  scheduled_at: string;
  completed_at: string | null;
  result: string | null;
  notes: string | null;
  status: string;
};

export type WhatsappMessage = {
  id: string;
  crm_lead_id: string | null;
  whatsapp_contact_id: string;
  direction: string;
  message_type: string;
  text_content: string | null;
  message_timestamp: string;
  referral_headline: string | null;
  referral_source_id: string | null;
};

export type CrmStatusHistory = {
  id: string;
  crm_lead_id: string;
  previous_status_name: string | null;
  new_status_name: string | null;
  change_source: string;
  notes: string | null;
  changed_at: string;
};

const LEAD_SELECT = `
  *,
  status:status_id ( id, name, metadata ),
  campaign:campaign_id ( id, campaign_name, platform ),
  salesperson:salesperson_id ( id, name ),
  origem:sales_origin_id ( id, name ),
  contact:whatsapp_contact_id ( id, normalized_phone, profile_name, total_inbound_messages, last_message_at ),
  work_order:linked_work_order_id ( id, os_number, status, total_gross_value )
`;

/* ============================ Catálogos ============================ */

export const CRM_STATUS_KIND = "crm_status";
export const CRM_RESULT_KIND = "crm_followup_result";
export const CRM_LOSS_KIND = "crm_loss_reason";
export const CRM_SERVICE_KIND = "crm_service_interest";

export function useCrmCatalog(kind: string, onlyActive = true) {
  return useQuery({
    queryKey: ["crm_catalog", kind, onlyActive],
    queryFn: async () => {
      let q = supabase
        .from("config_options")
        .select("id, name, active, display_order, metadata")
        .eq("kind", kind)
        .order("display_order");
      if (onlyActive) q = q.eq("active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as CrmStatus[];
    },
  });
}

export function statusMeta(status: { metadata?: unknown } | null | undefined) {
  const meta = (status?.metadata ?? {}) as Record<string, unknown>;
  return {
    color: typeof meta["color"] === "string" ? (meta["color"] as string) : "navy",
    stage: typeof meta["stage"] === "string" ? (meta["stage"] as string) : "outros",
    closed: meta["closed"] === true,
    lost: meta["lost"] === true,
  };
}

/* ============================ Leads ============================ */

export type LeadFilters = {
  from?: string | undefined;
  to?: string | undefined;
  statusId?: string | undefined;
  temperature?: string | undefined;
  campaignId?: string | undefined;
  salespersonId?: string | undefined;
  originId?: string | undefined;
  serviceInterest?: string | undefined;
  onlyOpen?: boolean | undefined;
  search?: string | undefined;
  converted?: "sim" | "nao" | undefined;
};

export function useCrmLeads(filters: LeadFilters = {}) {
  return useQuery({
    queryKey: ["crm_leads", filters],
    queryFn: async () => {
      let q = supabase.from("crm_leads").select(LEAD_SELECT).order("first_contact_date", { ascending: false });
      if (filters.from) q = q.gte("first_contact_date", filters.from);
      if (filters.to) q = q.lte("first_contact_date", filters.to);
      if (filters.statusId) q = q.eq("status_id", filters.statusId);
      if (filters.temperature) q = q.eq("temperature", filters.temperature);
      if (filters.campaignId) q = q.eq("campaign_id", filters.campaignId);
      if (filters.salespersonId) q = q.eq("salesperson_id", filters.salespersonId);
      if (filters.originId) q = q.eq("sales_origin_id", filters.originId);
      if (filters.serviceInterest) q = q.eq("service_interest", filters.serviceInterest);
      if (filters.onlyOpen) q = q.eq("is_open", true);
      if (filters.converted === "sim") q = q.not("linked_work_order_id", "is", null);
      if (filters.converted === "nao") q = q.is("linked_work_order_id", null);
      const { data, error } = await q.limit(1000);
      if (error) throw error;
      const rows = (data ?? []) as unknown as CrmLeadRow[];
      const term = (filters.search ?? "").trim().toLowerCase();
      if (!term) return rows;
      const digits = onlyDigits(term);
      return rows.filter((l) => {
        const haystack = [
          l.lead_name,
          l.phone,
          l.normalized_phone,
          l.upholstery_description,
          l.summary,
          l.notes,
          l.service_interest,
          l.campaign?.campaign_name,
          l.work_order?.os_number,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(term) || (digits.length >= 4 && (l.normalized_phone ?? "").includes(digits));
      });
    },
  });
}

export function useCrmLead(leadId: string) {
  return useQuery({
    queryKey: ["crm_lead", leadId],
    enabled: Boolean(leadId),
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_leads").select(LEAD_SELECT).eq("id", leadId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as CrmLeadRow | null;
    },
  });
}

export function useCrmCampaigns(onlyActive = false) {
  return useQuery({
    queryKey: ["crm_campaigns", onlyActive],
    queryFn: async () => {
      let q = supabase.from("crm_campaigns").select("*").order("campaign_name");
      if (onlyActive) q = q.eq("active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as CrmCampaign[];
    },
  });
}

export function useLeadTimeline(leadId: string, contactId: string | null) {
  return useQuery({
    queryKey: ["crm_lead_timeline", leadId, contactId],
    enabled: Boolean(leadId),
    queryFn: async () => {
      const [msgs, hist, follows] = await Promise.all([
        contactId
          ? supabase
              .from("whatsapp_messages")
              .select("id, crm_lead_id, whatsapp_contact_id, direction, message_type, text_content, message_timestamp, referral_headline, referral_source_id")
              .eq("whatsapp_contact_id", contactId)
              .order("message_timestamp", { ascending: false })
              .limit(300)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("crm_status_history")
          .select("*")
          .eq("crm_lead_id", leadId)
          .order("changed_at", { ascending: false }),
        supabase
          .from("crm_followups")
          .select("*")
          .eq("crm_lead_id", leadId)
          .order("scheduled_at", { ascending: false }),
      ]);
      if (msgs.error) throw msgs.error;
      if (hist.error) throw hist.error;
      if (follows.error) throw follows.error;
      return {
        messages: (msgs.data ?? []) as unknown as WhatsappMessage[],
        history: (hist.data ?? []) as unknown as CrmStatusHistory[],
        followups: (follows.data ?? []) as unknown as CrmFollowup[],
      };
    },
  });
}

export function useCrmInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const key of [
      "crm_leads",
      "crm_lead",
      "crm_lead_timeline",
      "crm_followups",
      "crm_campaigns",
      "crm_overview",
      "crm_catalog",
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

/* ============================ Ações ============================ */

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Muda o status do lead e grava histórico. Nunca apaga dados anteriores. */
export async function changeLeadStatus(
  lead: CrmLeadRow | CrmLead,
  newStatus: CrmStatus,
  options: { notes?: string | undefined; source?: string | undefined; lossReasonId?: string | null | undefined } = {},
) {
  const meta = statusMeta(newStatus);
  const previousName =
    "status" in lead && lead.status ? lead.status.name : null;

  const patch: Record<string, unknown> = {
    status_id: newStatus.id,
    is_open: !meta.closed,
    closed_at: meta.closed ? new Date().toISOString() : null,
    last_interaction_at: new Date().toISOString(),
  };
  if (meta.lost) patch["loss_reason_id"] = options.lossReasonId ?? lead.loss_reason_id ?? null;

  const { error } = await supabase.from("crm_leads").update(patch as never).eq("id", lead.id);
  if (error) throw error;

  const { error: histError } = await supabase.from("crm_status_history").insert({
    crm_lead_id: lead.id,
    previous_status_id: lead.status_id,
    new_status_id: newStatus.id,
    previous_status_name: previousName,
    new_status_name: newStatus.name,
    changed_by: await currentUserId(),
    change_source: options.source ?? "Manual",
    notes: options.notes ?? null,
  } as never);
  if (histError) throw histError;
}

export async function updateLead(leadId: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from("crm_leads")
    .update({ ...patch, last_interaction_at: new Date().toISOString() } as never)
    .eq("id", leadId);
  if (error) throw error;
}

/** Cria (ou reaproveita) o contato de WhatsApp de um telefone. */
export async function ensureContact(input: {
  phone: string;
  name?: string | null | undefined;
  waId?: string | null | undefined;
}): Promise<string | null> {
  const normalized = normalizePhone(input.phone);
  if (!normalized) return null;

  const { data: existing, error } = await supabase
    .from("whatsapp_contacts")
    .select("id, profile_name")
    .eq("normalized_phone", normalized)
    .maybeSingle();
  if (error) throw error;
  if (existing) {
    if (input.name && !existing.profile_name) {
      await supabase.from("whatsapp_contacts").update({ profile_name: input.name } as never).eq("id", existing.id);
    }
    return existing.id;
  }

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", input.phone)
    .maybeSingle();

  const { data: created, error: insertError } = await supabase
    .from("whatsapp_contacts")
    .insert({
      normalized_phone: normalized,
      display_phone: input.phone,
      profile_name: input.name ?? null,
      wa_id: input.waId ?? null,
      current_customer_id: customer?.id ?? null,
      is_existing_customer: Boolean(customer?.id),
    } as never)
    .select("id")
    .single();
  if (insertError) throw insertError;
  return created.id;
}

/** Cria um lead manual (ou nova oportunidade para um contato já existente). */
export async function createLead(input: {
  name: string;
  phone: string;
  upholstery?: string | undefined;
  serviceInterest?: string | undefined;
  temperature?: CrmTemperature | undefined;
  statusId?: string | null | undefined;
  summary?: string | undefined;
  salespersonId?: string | null | undefined;
  originId?: string | null | undefined;
  campaignId?: string | null | undefined;
  notes?: string | undefined;
  firstContactDate?: string | undefined;
  contactId?: string | null | undefined;
  importBatchId?: string | null | undefined;
}): Promise<string> {
  const contactId = input.contactId ?? (await ensureContact({ phone: input.phone, name: input.name }));
  const normalized = normalizePhone(input.phone);

  const { data: customer } = normalized
    ? await supabase.from("customers").select("id").eq("phone", input.phone).maybeSingle()
    : { data: null };

  const { data, error } = await supabase
    .from("crm_leads")
    .insert({
      whatsapp_contact_id: contactId,
      customer_id: customer?.id ?? null,
      lead_name: input.name || "Sem nome",
      phone: input.phone,
      normalized_phone: normalized || null,
      upholstery_description: input.upholstery ?? null,
      service_interest: input.serviceInterest ?? null,
      temperature: input.temperature ?? "FRIO",
      status_id: input.statusId ?? null,
      summary: input.summary ?? null,
      salesperson_id: input.salespersonId ?? null,
      sales_origin_id: input.originId ?? null,
      campaign_id: input.campaignId ?? null,
      notes: input.notes ?? null,
      first_contact_date: input.firstContactDate ?? todayISO(),
      last_interaction_at: new Date().toISOString(),
      import_batch_id: input.importBatchId ?? null,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function scheduleFollowup(leadId: string, scheduledAt: string, notes?: string) {
  const { error } = await supabase.from("crm_followups").insert({
    crm_lead_id: leadId,
    scheduled_at: scheduledAt,
    notes: notes ?? null,
    assigned_to: await currentUserId(),
  } as never);
  if (error) throw error;
  await supabase.from("crm_leads").update({ next_follow_up_at: scheduledAt } as never).eq("id", leadId);
}

export async function completeFollowup(
  followupId: string,
  leadId: string,
  result: string,
  notes?: string,
) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("crm_followups")
    .update({ completed_at: now, result, notes: notes ?? null, status: "Concluída" } as never)
    .eq("id", followupId);
  if (error) throw error;
  await supabase
    .from("crm_leads")
    .update({
      last_follow_up_at: now,
      follow_up_result: result,
      next_follow_up_at: null,
      last_interaction_at: now,
    } as never)
    .eq("id", leadId);
}

/** Sugestões de intervalo de repescagem (configuráveis em Configurações do CRM). */
export const DEFAULT_FOLLOWUP_HOURS = [24, 72];

export function suggestFollowupAt(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

export function leadTemperatureLabel(temperature: string): string {
  return temperature === "QUENTE" ? "Quente" : "Frio";
}

/** Vincula um lead do CRM à OS criada e encerra o lead como convertido. */
export async function linkLeadToWorkOrder(leadId: string, workOrderId: string) {
  const { data: statuses } = await supabase
    .from("config_options")
    .select("id, name, metadata")
    .eq("kind", CRM_STATUS_KIND)
    .eq("active", true)
    .order("display_order");

  const convertido = (statuses ?? []).find((s) => {
    const meta = statusMeta(s);
    return meta.closed && !meta.lost;
  });

  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, status_id")
    .eq("id", leadId)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("crm_leads")
    .update({
      linked_work_order_id: workOrderId,
      is_open: false,
      closed_at: nowIso,
      last_interaction_at: nowIso,
      next_follow_up_at: null,
      ...(convertido ? { status_id: convertido.id } : {}),
    } as never)
    .eq("id", leadId);
  if (error) throw error;

  if (convertido && lead?.status_id !== convertido.id) {
    await supabase.from("crm_status_history").insert({
      crm_lead_id: leadId,
      previous_status_id: lead?.status_id ?? null,
      new_status_id: convertido.id,
      reason: "Lead convertido em OS",
      source: "Nova OS",
    } as never);
  }
}
