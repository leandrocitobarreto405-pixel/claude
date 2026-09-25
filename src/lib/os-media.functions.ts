import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

async function assertWorkOrderAccess(workOrderId: string, supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("work_orders")
    .select("id")
    .eq("id", workOrderId)
    .maybeSingle();
  if (error || !data) throw new Error("Você não tem acesso a esta OS.");
}

export const getOsMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workOrderId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertWorkOrderAccess(data.workOrderId, context.supabase);
    const { listWorkOrderMedia } = await import("@/lib/os-media.server");
    return listWorkOrderMedia(data.workOrderId);
  });

export const createCustomerFolderLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workOrderId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertWorkOrderAccess(data.workOrderId, context.supabase);
    const { getCustomerFolderLink } = await import("@/lib/os-media.server");
    return getCustomerFolderLink(data.workOrderId);
  });

export const uploadOsMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FormData) => {
    if (!(input instanceof FormData)) throw new Error("Envio inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const workOrderId = String(data.get("workOrderId") ?? "");
    const destination = String(data.get("destination") ?? "");
    const file = data.get("file");
    const allowed = ["Antes", "Depois", "Vídeos", "Controle interno"] as const;
    if (!workOrderId || !allowed.includes(destination as (typeof allowed)[number])) {
      throw new Error("Destino do arquivo inválido.");
    }
    if (!(file instanceof File)) throw new Error("Selecione um arquivo.");
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      throw new Error("Envie somente fotos ou vídeos.");
    }
    if (file.size > 20 * 1024 * 1024) throw new Error("O arquivo deve ter no máximo 20 MB.");
    await assertWorkOrderAccess(workOrderId, context.supabase);
    const { uploadWorkOrderMedia } = await import("@/lib/os-media.server");
    return uploadWorkOrderMedia({
      workOrderId,
      destination: destination as (typeof allowed)[number],
      fileName: file.name.slice(0, 240),
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      userId: context.userId,
    });
  });
/** Destinos válidos para a OS e situação do compartilhamento com o e-mail do cliente. */
export const getOsMediaOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workOrderId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertWorkOrderAccess(data.workOrderId, context.supabase);
    const { workOrderMediaOptions } = await import("@/lib/os-media.server");
    return workOrderMediaOptions(data.workOrderId);
  });

/**
 * Chamado após concluir o atendimento: gera documento e termo pendentes e
 * compartilha a pasta da OS com o e-mail do cliente (uma única vez).
 */
export const finishOsSharing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workOrderId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertWorkOrderAccess(data.workOrderId, context.supabase);
    const { ensureOsDocuments } = await import("@/lib/os-docs.server");
    const docs = await ensureOsDocuments(data.workOrderId, context.userId);
    try {
      const { shareWithCustomerEmail } = await import("@/lib/os-media.server");
      const share = await shareWithCustomerEmail(data.workOrderId);
      return { docs, share };
    } catch (e) {
      console.error("Compartilhamento com o e-mail do cliente falhou:", e);
      return {
        docs,
        share: { shared: false as const, reason: "erro" as const },
      };
    }
  });
