import { createFileRoute } from "@tanstack/react-router";
import { processWhatsappPayload, verifyMetaSignature } from "@/lib/crm-webhook.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hooks/whatsapp")({
  server: {
    handlers: {
      // Verificação do webhook pela Meta
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const expected = process.env["WHATSAPP_VERIFY_TOKEN"];
        if (!expected) return json({ error: "Integração do WhatsApp ainda não configurada." }, 503);
        if (mode !== "subscribe" || token !== expected) {
          return new Response("Não autorizado", { status: 403 });
        }
        return new Response(challenge ?? "", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },

      POST: async ({ request }) => {
        const appSecret = process.env["WHATSAPP_APP_SECRET"];
        const raw = await request.text();

        if (!appSecret) {
          return json({ error: "Integração do WhatsApp ainda não configurada." }, 503);
        }
        if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
          return new Response("Assinatura inválida", { status: 401 });
        }

        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return json({ error: "Payload inválido." }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const eventReference = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

        const { data: event } = await supabaseAdmin
          .from("crm_webhook_events")
          .insert({
            event_reference: eventReference,
            processing_status: "Processando",
            payload: payload as never,
          })
          .select("id")
          .single();

        try {
          const result = await processWhatsappPayload(supabaseAdmin, payload, eventReference);
          if (event?.id) {
            await supabaseAdmin
              .from("crm_webhook_events")
              .update({
                processing_status:
                  result.messagesStored === 0 && result.duplicated > 0
                    ? "Ignorado por duplicidade"
                    : "Processado",
                processed_at: new Date().toISOString(),
                contact_id: result.contactId,
                crm_lead_id: result.leadId,
                contact_created: result.contactsCreated > 0,
                lead_created: result.leadsCreated > 0,
                messages_stored: result.messagesStored,
                duplicated_messages: result.duplicated,
              })
              .eq("id", event.id);
          }
          // A Meta exige 200 rápido; qualquer detalhe fica no registro do evento.
          return json({ ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Falha ao processar evento do WhatsApp:", message);
          if (event?.id) {
            await supabaseAdmin
              .from("crm_webhook_events")
              .update({
                processing_status: "Erro",
                processed_at: new Date().toISOString(),
                error_message: message.slice(0, 800),
              })
              .eq("id", event.id);
          }
          // 200 evita reenvio infinito da Meta; o evento fica salvo para reprocessar no app.
          return json({ ok: false, registered: true });
        }
      },
    },
  },
});
