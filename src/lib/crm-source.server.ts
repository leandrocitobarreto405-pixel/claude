import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneServer } from "./crm-webhook.server";

type AnyClient = SupabaseClient<any, any, any>;

export type CrmSourceType = "meta_lead_ads" | "google_ads" | "custom_form";

export type SourceIntegration = {
  id: string;
  name: string;
  source_type: CrmSourceType;
  webhook_token: string;
  secret: string | null;
  field_mapping: Record<string, string>;
  default_campaign_id: string | null;
  default_salesperson_id: string | null;
  active: boolean;
};

export type LeadSourcePayload = {
  externalId: string;
  name: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  service?: string | null;
  message?: string | null;
  campaignId?: string | null;
  adId?: string | null;
  formId?: string | null;
  createdAt?: string | null;
};

export type LeadSourceResult = {
  integrationId: string;
  contactId: string | null;
  leadId: string | null;
  created: boolean;
  duplicate: boolean;
  normalizedPhone: string;
};

export async function findIntegration(
  db: AnyClient,
  sourceType: string,
  token: string,
): Promise<SourceIntegration | null> {
  const { data, error } = await db
    .from("crm_source_integrations")
    .select("id, name, source_type, webhook_token, secret, field_mapping, default_campaign_id, default_salesperson_id, active")
    .eq("source_type", sourceType)
    .eq("webhook_token", token)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    field_mapping: (data.field_mapping as Record<string, string>) ?? {},
  } as SourceIntegration;
}

export function verifySourceSignature(
  sourceType: string,
  rawBody: string,
  secret: string | null | undefined,
  headers: Headers,
): boolean {
  if (!secret) return true;

  if (sourceType === "meta_lead_ads") {
    const header = headers.get("x-hub-signature-256");
    if (!header) return false;
    const received = header.startsWith("sha256=") ? header.slice(7) : header;
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(received, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  if (sourceType === "google_ads") {
    const received = headers.get("x-googleads-signature") ?? "";
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(received, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  // custom_form: segredo simples via header
  const auth = headers.get("authorization") ?? "";
  return auth.replace(/^Bearer\s+/i, "") === secret;
}

function mapFieldKey(mapping: Record<string, string>, key: string, fallback: string): string {
  const sourceKey = mapping[key] ?? key;
  return sourceKey || fallback;
}

function parseMetaLeadAds(payload: unknown, mapping: Record<string, string>): LeadSourcePayload | null {
  const body = (payload ?? {}) as Record<string, any>;
  const entry = body["entry"]?.[0];
  const change = entry?.["changes"]?.[0];
  const value = change?.["value"] ?? {};
  const lead = value["lead"] ?? {};
  const fieldData = lead["field_data"] ?? [];

  const fields: Record<string, string> = {};
  for (const item of fieldData) {
    const name = String(item?.["name"] ?? "");
    const values = item?.["values"];
    fields[name] = Array.isArray(values) ? String(values[0] ?? "") : String(values ?? "");
  }

  const rawName =
    fields[mapFieldKey(mapping, "name", "full_name")] ||
    fields["full_name"] ||
    fields["name"] ||
    "Sem nome";
  const rawPhone =
    fields[mapFieldKey(mapping, "phone", "phone_number")] ||
    fields["phone_number"] ||
    fields["phone"] ||
    "";
  if (!rawPhone) return null;

  return {
    externalId: String(lead["leadgen_id"] ?? ""),
    name: rawName,
    phone: rawPhone,
    email: fields[mapFieldKey(mapping, "email", "email")] || fields["email"] || null,
    city: fields[mapFieldKey(mapping, "city", "city")] || fields["city"] || null,
    service: fields[mapFieldKey(mapping, "service", "service")] || null,
    message: fields[mapFieldKey(mapping, "message", "message")] || null,
    campaignId: String(value["ad_campaign_id"] ?? value["campaign_id"] ?? lead["campaign_id"] ?? ""),
    adId: String(value["ad_id"] ?? value["adgroup_id"] ?? ""),
    formId: String(lead["form_id"] ?? value["form_id"] ?? ""),
    createdAt: lead["created_time"]
      ? new Date(lead["created_time"] * 1000).toISOString()
      : new Date().toISOString(),
  };
}

function parseGoogleAds(payload: unknown, mapping: Record<string, string>): LeadSourcePayload | null {
  const body = (payload ?? {}) as Record<string, any>;
  const userColumnData = body["userColumnData"] ?? [];
  const fields: Record<string, string> = {};
  for (const item of userColumnData) {
    const key = String(item?.["columnId"] ?? item?.["columnName"] ?? "");
    fields[key] = String(item?.["userFriendlyFormAnswer"] ?? item?.["value"] ?? "");
  }

  const rawName =
    fields[mapFieldKey(mapping, "name", "FULL_NAME")] ||
    fields["FULL_NAME"] ||
    `${fields["FIRST_NAME"] ?? ""} ${fields["LAST_NAME"] ?? ""}`.trim() ||
    "Sem nome";
  const rawPhone =
    fields[mapFieldKey(mapping, "phone", "PHONE_NUMBER")] ||
    fields["PHONE_NUMBER"] ||
    fields["PHONE_NUMBER_HOME"] ||
    "";
  if (!rawPhone) return null;

  return {
    externalId: String(body["leadId"] ?? ""),
    name: rawName,
    phone: rawPhone,
    email: fields[mapFieldKey(mapping, "email", "EMAIL")] || fields["EMAIL"] || null,
    city: fields[mapFieldKey(mapping, "city", "CITY")] || fields["CITY"] || null,
    service: fields[mapFieldKey(mapping, "service", "SERVICE")] || null,
    message: null,
    campaignId: String(body["campaignId"] ?? ""),
    adId: String(body["gclId"] ?? ""),
    formId: String(body["formId"] ?? ""),
    createdAt: body["submissionDateTime"]
      ? new Date(body["submissionDateTime"]).toISOString()
      : new Date().toISOString(),
  };
}

function parseCustomForm(payload: unknown, mapping: Record<string, string>): LeadSourcePayload | null {
  const body = (payload ?? {}) as Record<string, any>;
  const rawName =
    body[mapFieldKey(mapping, "name", "nome")] ||
    body["nome"] ||
    body["name"] ||
    body["full_name"] ||
    "Sem nome";
  const rawPhone =
    body[mapFieldKey(mapping, "phone", "telefone")] ||
    body["telefone"] ||
    body["phone"] ||
    body["whatsapp"] ||
    "";
  if (!rawPhone) return null;

  return {
    externalId: String(body["id"] ?? body["leadId"] ?? Date.now()),
    name: String(rawName),
    phone: String(rawPhone),
    email: body[mapFieldKey(mapping, "email", "email")] || body["email"] || null,
    city: body[mapFieldKey(mapping, "city", "cidade")] || body["cidade"] || body["city"] || null,
    service: body[mapFieldKey(mapping, "service", "servico")] || body["servico"] || body["service"] || null,
    message: body[mapFieldKey(mapping, "message", "mensagem")] || body["mensagem"] || body["message"] || null,
    campaignId: String(body["campanha"] ?? body["campaignId"] ?? ""),
    adId: String(body["adId"] ?? body["anuncio"] ?? ""),
    formId: String(body["formId"] ?? body["formulario"] ?? ""),
    createdAt: body["createdAt"] ? new Date(body["createdAt"]).toISOString() : new Date().toISOString(),
  };
}

export function parseLeadSourcePayload(
  sourceType: CrmSourceType,
  payload: unknown,
  mapping: Record<string, string>,
): LeadSourcePayload | null {
  if (sourceType === "meta_lead_ads") return parseMetaLeadAds(payload, mapping);
  if (sourceType === "google_ads") return parseGoogleAds(payload, mapping);
  return parseCustomForm(payload, mapping);
}

async function resolveCampaign(db: AnyClient, integration: SourceIntegration, payload: LeadSourcePayload) {
  if (integration.default_campaign_id) return integration.default_campaign_id;
  if (!payload.campaignId) return null;
  const { data } = await db
    .from("crm_campaigns")
    .select("id")
    .or(
      `campaign_external_id.eq.${payload.campaignId},ad_set_external_id.eq.${payload.campaignId},ad_external_id.eq.${payload.campaignId}`,
    )
    .maybeSingle();
  return data?.id ?? null;
}

async function initialStatusId(db: AnyClient): Promise<string | null> {
  const { data } = await db
    .from("config_options")
    .select("id")
    .eq("kind", "crm_status")
    .eq("name", "Novo contato")
    .maybeSingle();
  return data?.id ?? null;
}

async function originIdForSource(db: AnyClient, sourceType: CrmSourceType): Promise<string | null> {
  const searchTerm = sourceType === "meta_lead_ads" ? "meta" : sourceType === "google_ads" ? "google" : "site";
  const { data } = await db
    .from("config_options")
    .select("id, name")
    .eq("kind", "sales_origin")
    .ilike("name", `%${searchTerm}%`)
    .maybeSingle();
  if (data) return data.id;
  const { data: fallback } = await db
    .from("config_options")
    .select("id")
    .eq("kind", "sales_origin")
    .eq("active", true)
    .order("display_order")
    .limit(1)
    .maybeSingle();
  return fallback?.id ?? null;
}

async function ensureContactFromSource(
  db: AnyClient,
  payload: LeadSourcePayload,
): Promise<{ contactId: string | null; customerId: string | null }> {
  const normalized = normalizePhoneServer(payload.phone);
  if (!normalized) return { contactId: null, customerId: null };

  const { data: existing, error } = await db
    .from("whatsapp_contacts")
    .select("id, profile_name, current_customer_id")
    .eq("normalized_phone", normalized)
    .maybeSingle();
  if (error) throw error;

  if (existing) {
    if (payload.name && existing.profile_name !== payload.name) {
      await db
        .from("whatsapp_contacts")
        .update({ profile_name: payload.name, last_contact_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return { contactId: existing.id, customerId: existing.current_customer_id ?? null };
  }

  const { data: customer } = await db
    .from("customers")
    .select("id")
    .or(`phone.eq.${normalized},phone.eq.${normalized.slice(2)}`)
    .maybeSingle();

  const { data: created, error: insertError } = await db
    .from("whatsapp_contacts")
    .insert({
      normalized_phone: normalized,
      display_phone: payload.phone,
      profile_name: payload.name ?? null,
      first_contact_at: new Date().toISOString(),
      last_contact_at: new Date().toISOString(),
      total_inbound_messages: 0,
      total_outbound_messages: 0,
      current_customer_id: customer?.id ?? null,
      is_existing_customer: Boolean(customer?.id),
      active: true,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return { contactId: created.id, customerId: customer?.id ?? null };
}

/**
 * Processa um lead vindo de uma fonte externa (Meta, Google Ads ou formulário próprio).
 * Cria contato e lead se não existir; reaproveita contato existente pelo telefone.
 */
export async function processLeadSourcePayload(
  db: AnyClient,
  integration: SourceIntegration,
  payload: unknown,
): Promise<LeadSourceResult> {
  const parsed = parseLeadSourcePayload(integration.source_type, payload, integration.field_mapping);
  const result: LeadSourceResult = {
    integrationId: integration.id,
    contactId: null,
    leadId: null,
    created: false,
    duplicate: false,
    normalizedPhone: "",
  };

  if (!parsed) return result;

  const normalized = normalizePhoneServer(parsed.phone);
  result.normalizedPhone = normalized;
  if (!normalized) return result;

  const { contactId, customerId } = await ensureContactFromSource(db, parsed);
  result.contactId = contactId;
  if (!contactId) return result;

  // Verifica se já existe lead aberto para o mesmo telefone/contato
  const { data: openLead } = await db
    .from("crm_leads")
    .select("id, status_id")
    .or(`whatsapp_contact_id.eq.${contactId},normalized_phone.eq.${normalized}`)
    .eq("is_open", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openLead) {
    result.leadId = openLead.id;
    result.duplicate = true;
    await db
      .from("crm_leads")
      .update({
        last_interaction_at: new Date().toISOString(),
        lead_name: parsed.name !== "Sem nome" ? parsed.name : undefined,
        campaign_id: await resolveCampaign(db, integration, parsed),
      })
      .eq("id", openLead.id);
    return result;
  }

  const statusId = await initialStatusId(db);
  const originId = await originIdForSource(db, integration.source_type);
  const campaignId = await resolveCampaign(db, integration, parsed);

  const { data: createdLead, error } = await db
    .from("crm_leads")
    .insert({
      whatsapp_contact_id: contactId,
      customer_id: customerId ?? null,
      lead_name: parsed.name || "Sem nome",
      phone: parsed.phone,
      normalized_phone: normalized,
      upholstery_description: null,
      service_interest: parsed.service ?? null,
      temperature: "FRIO",
      status_id: statusId,
      summary: parsed.message ?? null,
      summary_source: "Automático",
      salesperson_id: integration.default_salesperson_id ?? null,
      sales_origin_id: originId,
      campaign_id: campaignId,
      ad_id: parsed.adId || null,
      source_type: integration.source_type,
      referral_data: { external_id: parsed.externalId, form_id: parsed.formId },
      first_contact_date: parsed.createdAt ? parsed.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
      last_interaction_at: new Date().toISOString(),
      is_open: true,
    })
    .select("id")
    .single();
  if (error) throw error;

  result.leadId = createdLead.id;
  result.created = true;

  if (statusId) {
    await db.from("crm_status_history").insert({
      crm_lead_id: createdLead.id,
      new_status_id: statusId,
      new_status_name: "Novo contato",
      change_source: `Integração: ${integration.name}`,
      notes: `Lead criado automaticamente via ${integration.source_type}.`,
    });
  }

  return result;
}
