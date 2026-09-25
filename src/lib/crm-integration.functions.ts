import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { processWhatsappPayload } from "./crm-webhook.server";

async function assertStaff(
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  },
  userId: string,
) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (data !== true) throw new Error("Acesso restrito à equipe.");
}

export type WhatsappIntegrationStatus = {
  state:
    | "Não configurada"
    | "Aguardando conexão"
    | "Conectada"
    | "Recebendo mensagens"
    | "Erro na integração";
  secrets: { name: string; label: string; configured: boolean }[];
  webhookUrl: string;
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
  errorCount: number;
  processedCount: number;
  lastError: string | null;
};

const SECRET_LABELS: { name: string; label: string }[] = [
  { name: "WHATSAPP_VERIFY_TOKEN", label: "Token de verificação do webhook" },
  { name: "WHATSAPP_APP_SECRET", label: "Chave secreta do aplicativo (assinatura)" },
  { name: "WHATSAPP_ACCESS_TOKEN", label: "Token de acesso da API" },
  { name: "WHATSAPP_PHONE_NUMBER_ID", label: "ID do número de telefone" },
  { name: "WHATSAPP_WABA_ID", label: "ID da conta comercial (WABA)" },
];

export const getWhatsappStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsappIntegrationStatus> => {
    await assertStaff(context.supabase as never, context.userId);

    const secrets = SECRET_LABELS.map((s) => ({
      ...s,
      configured: Boolean(process.env[s.name]),
    }));
    const essentialOk = secrets
      .filter((s) => s.name === "WHATSAPP_VERIFY_TOKEN" || s.name === "WHATSAPP_APP_SECRET")
      .every((s) => s.configured);

    const { data: events } = await context.supabase
      .from("crm_webhook_events")
      .select("received_at, processed_at, processing_status, error_message")
      .order("received_at", { ascending: false })
      .limit(200);

    const rows = events ?? [];
    const errorCount = rows.filter((e) => e.processing_status === "Erro").length;
    const processed = rows.filter((e) => e.processing_status === "Processado");
    const lastError = rows.find((e) => e.processing_status === "Erro")?.error_message ?? null;

    let state: WhatsappIntegrationStatus["state"] = "Não configurada";
    if (essentialOk) state = "Aguardando conexão";
    if (essentialOk && rows.length > 0) state = "Conectada";
    if (essentialOk && processed.length > 0) state = "Recebendo mensagens";
    if (essentialOk && errorCount > 0 && processed.length === 0) state = "Erro na integração";

    const origin = process.env["LOVABLE_PUBLIC_URL"] ?? "";

    return {
      state,
      secrets,
      webhookUrl: `${origin}/api/public/hooks/whatsapp`,
      lastReceivedAt: rows[0]?.received_at ?? null,
      lastProcessedAt: processed[0]?.processed_at ?? null,
      errorCount,
      processedCount: processed.length,
      lastError,
    };
  });

export const listWebhookEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { data, error } = await context.supabase
      .from("crm_webhook_events")
      .select(
        "id, event_reference, received_at, processed_at, processing_status, messages_stored, duplicated_messages, error_message, retry_count",
      )
      .order("received_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  });

/** Reprocessa um evento que ficou com erro, sem duplicar mensagens já gravadas. */
export const reprocessWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { eventId: string }) => ({ eventId: String(input.eventId) }))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { data: event, error } = await context.supabase
      .from("crm_webhook_events")
      .select("id, event_reference, payload, retry_count")
      .eq("id", data.eventId)
      .maybeSingle();
    if (error) throw error;
    if (!event) throw new Error("Evento não encontrado.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      const result = await processWhatsappPayload(
        supabaseAdmin,
        event.payload,
        event.event_reference ?? `retry_${event.id}`,
      );
      await supabaseAdmin
        .from("crm_webhook_events")
        .update({
          processing_status: "Processado",
          processed_at: new Date().toISOString(),
          error_message: null,
          retry_count: Number(event.retry_count ?? 0) + 1,
          messages_stored: result.messagesStored,
          duplicated_messages: result.duplicated,
        })
        .eq("id", event.id);
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabaseAdmin
        .from("crm_webhook_events")
        .update({
          processing_status: "Erro",
          error_message: message.slice(0, 800),
          retry_count: Number(event.retry_count ?? 0) + 1,
        })
        .eq("id", event.id);
      throw new Error("Não foi possível reprocessar o evento.");
    }
  });

/** Simula um recebimento para validar o fluxo antes de conectar a Meta. */
export const simulateWhatsappMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string; name: string; text: string }) => ({
    phone: String(input.phone ?? "").slice(0, 20),
    name: String(input.name ?? "").slice(0, 120),
    text: String(input.text ?? "").slice(0, 2000),
  }))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const digits = data.phone.replace(/\D/g, "");
    if (digits.length < 10) throw new Error("Informe um telefone válido com DDD.");
    const waId = digits.length <= 11 ? `55${digits}` : digits;
    const reference = `teste_${Date.now()}`;
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: waId, profile: { name: data.name || "Teste CRM" } }],
                messages: [
                  {
                    from: waId,
                    id: reference,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: data.text || "Mensagem de teste do CRM." },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await processWhatsappPayload(supabaseAdmin, payload, reference);
    await supabaseAdmin.from("crm_webhook_events").insert({
      event_reference: reference,
      processing_status: "Processado",
      processed_at: new Date().toISOString(),
      contact_id: result.contactId,
      crm_lead_id: result.leadId,
      contact_created: result.contactsCreated > 0,
      lead_created: result.leadsCreated > 0,
      messages_stored: result.messagesStored,
      duplicated_messages: result.duplicated,
      payload: payload as never,
    });
    return result;
  });
