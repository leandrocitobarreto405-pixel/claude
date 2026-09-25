import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sourceTypeSchema = z.enum(["meta_lead_ads", "google_ads", "custom_form"]);

export const listSourceIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("crm_source_integrations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getCampaignsForIntegration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("crm_campaigns")
      .select("id, campaign_name, platform")
      .eq("active", true)
      .order("campaign_name");
    if (error) throw error;
    return data ?? [];
  });

export const getSalespeopleForIntegration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("salespeople")
      .select("id, name")
      .eq("active", true)
      .order("name");
    if (error) throw error;
    return data ?? [];
  });

const createSourceSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(120),
  source_type: sourceTypeSchema,
  webhook_token: z.string().trim().min(8, "Token precisa ter no mínimo 8 caracteres").max(120),
  secret: z.string().trim().max(500).nullable().optional(),
  field_mapping: z.record(z.string().trim(), z.string().trim()).default({}),
  default_campaign_id: z.string().uuid().nullable().optional(),
  default_salesperson_id: z.string().uuid().nullable().optional(),
  active: z.boolean().default(true),
});

export const createSourceIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => createSourceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: created, error } = await context.supabase
      .from("crm_source_integrations")
      .insert({
        name: data.name,
        source_type: data.source_type,
        webhook_token: data.webhook_token,
        secret: data.secret ?? null,
        field_mapping: data.field_mapping,
        default_campaign_id: data.default_campaign_id ?? null,
        default_salesperson_id: data.default_salesperson_id ?? null,
        active: data.active,
      })
      .select("id")
      .single();
    if (error) throw error;
    return created;
  });

const updateSourceSchema = createSourceSchema.extend({
  id: z.string().uuid(),
});

export const updateSourceIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => updateSourceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("crm_source_integrations")
      .update({
        name: data.name,
        source_type: data.source_type,
        webhook_token: data.webhook_token,
        secret: data.secret ?? null,
        field_mapping: data.field_mapping,
        default_campaign_id: data.default_campaign_id ?? null,
        default_salesperson_id: data.default_salesperson_id ?? null,
        active: data.active,
      })
      .eq("id", data.id)
      .select("id")
      .single();
    if (error) throw error;
    return updated;
  });

export const deleteSourceIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("crm_source_integrations")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const simulateSourceIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        source_type: sourceTypeSchema,
        payload: z.record(z.string(), z.any()),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { processLeadSourcePayload, parseLeadSourcePayload } =
      await import("@/lib/crm-source.server");
    const mapped = parseLeadSourcePayload(data.source_type, data.payload, {});
    if (!mapped) throw new Error("Não foi possível extrair nome e telefone do payload de teste.");

    const { data: row } = await context.supabase
      .from("crm_source_integrations")
      .select(
        "id, name, source_type, webhook_token, secret, field_mapping, default_campaign_id, default_salesperson_id, active",
      )
      .eq("source_type", data.source_type)
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    if (!row) throw new Error("Nenhuma integração ativa do tipo informado para simular.");

    const integration = {
      ...row,
      field_mapping: (row.field_mapping as Record<string, string>) ?? {},
    };

    const result = await processLeadSourcePayload(context.supabase, integration, data.payload);
    return { mapped, result };
  });
