import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYSTEM_PROMPT = `Você organiza conversas de WhatsApp de uma empresa brasileira de higienização e impermeabilização de estofados.
Responda SEMPRE em português do Brasil e SOMENTE com JSON válido, sem texto extra.
Regras obrigatórias:
- Use apenas informações presentes na conversa. Nunca invente preço, valor, data, quantidade, endereço ou decisão de compra.
- Se um campo não estiver claro na conversa, devolva null.
- "temperature" é "QUENTE" apenas quando o cliente demonstra intenção clara (pede preço para fechar, pergunta agenda, confirma interesse); caso contrário "FRIO".
Formato:
{"summary":string,"upholstery":string|null,"service_interest":"Higienização"|"Impermeabilização"|"Higienização e impermeabilização"|null,"city":string|null,"intent":string|null,"objections":string|null,"next_action":string|null,"temperature":"QUENTE"|"FRIO"}`;

export const sugerirResumoDoLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string }) => ({ leadId: String(input.leadId) }))
  .handler(async ({ data, context }) => {
    const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (isStaff !== true) throw new Error("Acesso restrito à equipe.");

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("A IA não está disponível neste momento.");

    const { data: lead, error } = await context.supabase
      .from("crm_leads")
      .select("id, lead_name, whatsapp_contact_id, temperature_confirmed, upholstery_description, service_interest")
      .eq("id", data.leadId)
      .maybeSingle();
    if (error) throw error;
    if (!lead) throw new Error("Lead não encontrado.");

    let conversa = "";
    if (lead.whatsapp_contact_id) {
      const { data: msgs } = await context.supabase
        .from("whatsapp_messages")
        .select("direction, message_type, text_content, message_timestamp")
        .eq("whatsapp_contact_id", lead.whatsapp_contact_id)
        .order("message_timestamp", { ascending: true })
        .limit(120);
      conversa = (msgs ?? [])
        .map((m) => `${m.direction === "Recebida" ? "Cliente" : "Empresa"}: ${m.text_content ?? `(${m.message_type})`}`)
        .join("\n")
        .slice(0, 12000);
    }
    if (!conversa.trim()) throw new Error("Não há mensagens registradas para resumir.");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Lead: ${lead.lead_name}\n\nConversa:\n${conversa}` },
        ],
      }),
    });
    if (!response.ok) {
      console.error("Falha na IA do CRM:", response.status, await response.text());
      throw new Error("Não foi possível gerar a sugestão agora. Tente novamente em instantes.");
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      throw new Error("A IA respondeu em um formato inesperado. Tente novamente.");
    }

    const str = (key: string): string | null => {
      const value = parsed[key];
      return typeof value === "string" && value.trim() ? value.trim().slice(0, 2000) : null;
    };
    const temperature = parsed["temperature"] === "QUENTE" ? "QUENTE" : "FRIO";

    const patch: Record<string, unknown> = {
      summary: str("summary"),
      summary_source: "IA",
    };
    // Não sobrescreve dados já preenchidos manualmente.
    if (!lead.upholstery_description && str("upholstery")) patch["upholstery_description"] = str("upholstery");
    if (!lead.service_interest && str("service_interest")) patch["service_interest"] = str("service_interest");
    if (!lead.temperature_confirmed) {
      patch["temperature"] = temperature;
      patch["temperature_confirmed"] = false;
    }

    const { error: updateError } = await context.supabase
      .from("crm_leads")
      .update(patch as never)
      .eq("id", lead.id);
    if (updateError) throw updateError;

    return {
      summary: str("summary"),
      temperature: lead.temperature_confirmed ? null : temperature,
      intent: str("intent"),
      objections: str("objections"),
      nextAction: str("next_action"),
      city: str("city"),
    };
  });
