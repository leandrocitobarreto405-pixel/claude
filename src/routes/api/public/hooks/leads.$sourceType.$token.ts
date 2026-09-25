import { createFileRoute } from "@tanstack/react-router";
import {
  findIntegration,
  processLeadSourcePayload,
  verifySourceSignature,
} from "@/lib/crm-source.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hooks/leads/$sourceType/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const sourceType = params.sourceType;
        const token = params.token;
        if (!sourceType || !token) {
          return json({ error: "Parâmetros de integração inválidos." }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const integration = await findIntegration(supabaseAdmin, sourceType, token);
        if (!integration) {
          return json({ error: "Integração não encontrada ou inativa." }, 404);
        }

        const raw = await request.text();
        if (!verifySourceSignature(sourceType, raw, integration.secret, request.headers)) {
          return new Response("Assinatura inválida.", { status: 401 });
        }

        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return json({ error: "Payload inválido." }, 400);
        }

        try {
          const result = await processLeadSourcePayload(supabaseAdmin, integration, payload);
          return json({
            ok: true,
            contactId: result.contactId,
            leadId: result.leadId,
            created: result.created,
            duplicate: result.duplicate,
            normalizedPhone: result.normalizedPhone,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Falha ao processar lead externo:", message);
          return json({ error: "Falha ao processar lead.", detail: message.slice(0, 500) }, 500);
        }
      },
    },
  },
});
