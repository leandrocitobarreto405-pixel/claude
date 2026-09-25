import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type AnyClient = SupabaseClient<any, any, any>;

/** Normalização de telefone — igual à do app (mantida aqui para uso no servidor). */
export function normalizePhoneServer(input: string | null | undefined): string {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length <= 11 ? `55${digits}` : digits;
}

export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header) return false;
  const received = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type IncomingMessage = {
  wamid: string | null;
  waId: string;
  profileName: string | null;
  type: string;
  text: string | null;
  mediaId: string | null;
  timestamp: string;
  replyTo: string | null;
  referral: {
    sourceId: string | null;
    sourceUrl: string | null;
    headline: string | null;
    body: string | null;
  } | null;
};

const TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contacts: "Contato",
  button: "Botão",
  interactive: "Interativo",
};

function extractText(message: Record<string, any>): string | null {
  if (message["text"]?.body) return String(message["text"].body);
  if (message["button"]?.text) return String(message["button"].text);
  if (message["interactive"]?.button_reply?.title)
    return String(message["interactive"].button_reply.title);
  if (message["interactive"]?.list_reply?.title)
    return String(message["interactive"].list_reply.title);
  for (const key of ["image", "video", "document", "audio"]) {
    if (message[key]?.caption) return String(message[key].caption);
  }
  return null;
}

function extractMediaId(message: Record<string, any>): string | null {
  for (const key of ["image", "video", "document", "audio", "sticker"]) {
    if (message[key]?.id) return String(message[key].id);
  }
  return null;
}

/** Lê o payload da Meta e devolve as mensagens recebidas, sem lançar erro por campo faltando. */
export function parseMetaPayload(payload: unknown): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  const body = (payload ?? {}) as Record<string, any>;
  const entries = Array.isArray(body["entry"]) ? body["entry"] : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.["changes"]) ? entry["changes"] : [];
    for (const change of changes) {
      const value = change?.["value"] ?? {};
      const contacts = Array.isArray(value["contacts"]) ? value["contacts"] : [];
      const messages = Array.isArray(value["messages"]) ? value["messages"] : [];
      for (const message of messages) {
        const waId = String(message?.["from"] ?? contacts[0]?.wa_id ?? "");
        if (!waId) continue;
        const profile =
          contacts.find((c: any) => String(c?.wa_id ?? "") === waId)?.profile?.name ??
          contacts[0]?.profile?.name ??
          null;
        const tsSeconds = Number(message?.["timestamp"]);
        const referral = message?.["referral"];
        out.push({
          wamid: message?.["id"] ? String(message["id"]) : null,
          waId,
          profileName: profile ? String(profile) : null,
          type: TYPE_LABELS[String(message?.["type"] ?? "")] ?? "Outro",
          text: extractText(message ?? {}),
          mediaId: extractMediaId(message ?? {}),
          timestamp: Number.isFinite(tsSeconds)
            ? new Date(tsSeconds * 1000).toISOString()
            : new Date().toISOString(),
          replyTo: message?.["context"]?.id ? String(message["context"].id) : null,
          referral: referral
            ? {
                sourceId: referral["source_id"] ? String(referral["source_id"]) : null,
                sourceUrl: referral["source_url"] ? String(referral["source_url"]) : null,
                headline: referral["headline"] ? String(referral["headline"]) : null,
                body: referral["body"] ? String(referral["body"]) : null,
              }
            : null,
        });
      }
    }
  }
  return out;
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

async function findCampaign(db: AnyClient, sourceId: string | null) {
  if (!sourceId) return null;
  const { data } = await db
    .from("crm_campaigns")
    .select("id")
    .eq("ad_external_id", sourceId)
    .maybeSingle();
  return data?.id ?? null;
}

async function whatsappOriginId(db: AnyClient): Promise<string | null> {
  const { data } = await db
    .from("config_options")
    .select("id, name")
    .eq("kind", "sales_origin")
    .ilike("name", "%whats%")
    .maybeSingle();
  return data?.id ?? null;
}

export type WebhookProcessResult = {
  messagesStored: number;
  duplicated: number;
  contactsCreated: number;
  leadsCreated: number;
  contactId: string | null;
  leadId: string | null;
};

/**
 * Processa um payload da Meta de forma idempotente:
 * contato -> oportunidade aberta -> mensagem. Nunca duplica nem sobrescreve dado confirmado.
 */
export async function processWhatsappPayload(
  db: AnyClient,
  payload: unknown,
  eventReference: string,
): Promise<WebhookProcessResult> {
  const messages = parseMetaPayload(payload);
  const result: WebhookProcessResult = {
    messagesStored: 0,
    duplicated: 0,
    contactsCreated: 0,
    leadsCreated: 0,
    contactId: null,
    leadId: null,
  };
  if (messages.length === 0) return result;

  const statusId = await initialStatusId(db);
  const originId = await whatsappOriginId(db);

  for (const message of messages) {
    const normalized = normalizePhoneServer(message.waId);
    if (!normalized) continue;

    // Contato
    let contactId: string | null = null;
    const { data: contact } = await db
      .from("whatsapp_contacts")
      .select("id, profile_name, total_inbound_messages")
      .eq("normalized_phone", normalized)
      .maybeSingle();

    if (contact) {
      contactId = contact.id;
      await db
        .from("whatsapp_contacts")
        .update({
          profile_name: contact.profile_name ?? message.profileName,
          wa_id: message.waId,
          last_contact_at: message.timestamp,
          last_message_at: message.timestamp,
          total_inbound_messages: Number(contact.total_inbound_messages ?? 0) + 1,
        })
        .eq("id", contact.id);
    } else {
      const { data: customer } = await db
        .from("customers")
        .select("id")
        .or(`phone.eq.${normalized},phone.eq.${normalized.slice(2)}`)
        .maybeSingle();
      const { data: created, error } = await db
        .from("whatsapp_contacts")
        .insert({
          normalized_phone: normalized,
          display_phone: message.waId,
          wa_id: message.waId,
          profile_name: message.profileName,
          first_contact_at: message.timestamp,
          last_contact_at: message.timestamp,
          last_message_at: message.timestamp,
          total_inbound_messages: 1,
          current_customer_id: customer?.id ?? null,
          is_existing_customer: Boolean(customer?.id),
        })
        .select("id")
        .single();
      if (error) throw error;
      contactId = created.id;
      result.contactsCreated += 1;
    }
    if (!contactId) continue;
    result.contactId = contactId;

    // Oportunidade aberta (não cria nova se já existe aberta)
    const { data: openLead } = await db
      .from("crm_leads")
      .select("id, lead_name, campaign_id, ad_id, referral_data")
      .eq("whatsapp_contact_id", contactId)
      .eq("is_open", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let leadId: string | null = openLead?.id ?? null;
    const campaignId = await findCampaign(db, message.referral?.sourceId ?? null);

    if (!leadId) {
      const { data: customerLink } = await db
        .from("customers")
        .select("id")
        .or(`phone.eq.${normalized},phone.eq.${normalized.slice(2)}`)
        .maybeSingle();
      const { data: createdLead, error } = await db
        .from("crm_leads")
        .insert({
          whatsapp_contact_id: contactId,
          customer_id: customerLink?.id ?? null,
          lead_name: message.profileName ?? "Sem nome",
          phone: message.waId,
          normalized_phone: normalized,
          temperature: "FRIO",
          status_id: statusId,
          sales_origin_id: originId,
          campaign_id: campaignId,
          ad_id: message.referral?.sourceId ?? null,
          source_type: message.referral ? "Anúncio" : "WhatsApp direto",
          referral_data: message.referral ?? {},
          first_contact_date: message.timestamp.slice(0, 10),
          last_interaction_at: message.timestamp,
          summary_source: "Automático",
        })
        .select("id")
        .single();
      if (error) throw error;
      leadId = createdLead.id;
      result.leadsCreated += 1;
      if (statusId) {
        await db.from("crm_status_history").insert({
          crm_lead_id: leadId,
          new_status_id: statusId,
          new_status_name: "Novo contato",
          change_source: "Webhook do WhatsApp",
          notes: "Lead criado automaticamente a partir de uma mensagem recebida.",
        });
      }
    } else {
      await db
        .from("crm_leads")
        .update({
          last_interaction_at: message.timestamp,
          lead_name:
            openLead?.lead_name && openLead.lead_name !== "Sem nome"
              ? openLead.lead_name
              : (message.profileName ?? "Sem nome"),
          campaign_id: openLead?.campaign_id ?? campaignId,
          ad_id: openLead?.ad_id ?? message.referral?.sourceId ?? null,
        })
        .eq("id", leadId);
    }
    result.leadId = leadId;

    // Mensagem (idempotente pelo id do WhatsApp)
    const { error: msgError } = await db.from("whatsapp_messages").insert({
      whatsapp_contact_id: contactId,
      crm_lead_id: leadId,
      whatsapp_message_id: message.wamid,
      direction: "Recebida",
      message_type: message.type,
      text_content: message.text,
      media_id: message.mediaId,
      message_timestamp: message.timestamp,
      reply_to_message_id: message.replyTo,
      referral_source_id: message.referral?.sourceId ?? null,
      referral_source_url: message.referral?.sourceUrl ?? null,
      referral_headline: message.referral?.headline ?? null,
      referral_body: message.referral?.body ?? null,
      raw_event_reference: eventReference,
    });
    if (msgError) {
      const duplicate =
        String(msgError.code) === "23505" ||
        String(msgError.message ?? "")
          .toLowerCase()
          .includes("duplicate");
      if (duplicate) result.duplicated += 1;
      else throw msgError;
    } else {
      result.messagesStored += 1;
    }
  }

  return result;
}
