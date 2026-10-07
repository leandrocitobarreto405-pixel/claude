import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEmpresa } from "@/lib/empresa.middleware";
import type { Database } from "@/integrations/supabase/types";
import { ENDERECO_APP, ORIGENS_DO_APP } from "@/lib/enderecos";
import { tamanhoLegivel, validarMidia } from "@/lib/midia-os";

async function assertWorkOrderAccess(workOrderId: string, supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("work_orders")
    .select("id")
    .eq("id", workOrderId)
    .maybeSingle();
  if (error || !data) throw new Error("Você não tem acesso a esta OS.");
}

export const getOsMedia = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { workOrderId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertWorkOrderAccess(data.workOrderId, context.supabase);
    const { listWorkOrderMedia } = await import("@/lib/os-media.server");
    return listWorkOrderMedia(data.workOrderId);
  });

export const createCustomerFolderLink = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { workOrderId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertWorkOrderAccess(data.workOrderId, context.supabase);
    const { getCustomerFolderLink } = await import("@/lib/os-media.server");
    return getCustomerFolderLink(data.workOrderId);
  });

const DESTINOS = ["Antes", "Depois", "Vídeos", "Controle interno"] as const;
type Destino = (typeof DESTINOS)[number];
function destinoValido(d: unknown): Destino {
  if (!DESTINOS.includes(d as Destino)) throw new Error("Campo de fotos inválido.");
  return d as Destino;
}

/** Origem do app que o Google deve aceitar no envio direto (só as do app e a local). */
function origemDoEnvio(origem: unknown): string {
  const o = typeof origem === "string" ? origem : "";
  if (ORIGENS_DO_APP.includes(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))
    return o;
  return ENDERECO_APP;
}

/**
 * Abre o envio de uma foto ou vídeo: o celular manda o arquivo direto ao Google Drive (pasta da
 * OS), em pedaços, sem passar pelo servidor. Vale também depois da OS concluída.
 */
export const abrirEnvioMidiaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator(
    (input: {
      workOrderId: string;
      destination: string;
      nome: string;
      tipo: string;
      tamanho: number;
      origem: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const destino = destinoValido(data.destination);
    const v = validarMidia(data.nome, data.tipo, Number(data.tamanho));
    if (!v.ok) throw new Error(v.motivo);
    await assertWorkOrderAccess(data.workOrderId, context.supabase);
    const { abrirEnvioMidia } = await import("@/lib/os-media.server");
    return abrirEnvioMidia({
      workOrderId: data.workOrderId,
      destination: destino,
      nome: String(data.nome).slice(0, 240),
      tipo: v.tipo,
      tamanho: Number(data.tamanho),
      origem: origemDoEnvio(data.origem),
    });
  });

/** Quanto o Google já recebeu de um envio (para continuar depois que a internet volta). */
export const situacaoEnvioMidiaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { sessao: string; tamanho: number }) => input)
  .handler(async ({ data }) => {
    const u = new URL(String(data.sessao));
    if (
      u.origin !== "https://www.googleapis.com" ||
      !u.pathname.startsWith("/upload/drive/v3/files") ||
      !u.searchParams.get("upload_id")
    )
      throw new Error("Envio inválido.");
    const { situacaoDoEnvio } = await import("@/lib/google-docs.server");
    const r = await situacaoDoEnvio(u.toString(), Number(data.tamanho));
    return { recebidos: r.recebidos, fileId: r.arquivo?.id ?? null };
  });

/** Registra na OS o arquivo que chegou ao Drive. */
export const registrarEnvioMidiaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { workOrderId: string; destination: string; fileId: string }) => input)
  .handler(async ({ data, context }) => {
    const destino = destinoValido(data.destination);
    if (!/^[\w-]{10,}$/.test(String(data.fileId))) throw new Error("Arquivo inválido.");
    await assertWorkOrderAccess(data.workOrderId, context.supabase);
    const { registrarEnvioMidia } = await import("@/lib/os-media.server");
    return registrarEnvioMidia({
      workOrderId: data.workOrderId,
      destination: destino,
      fileId: data.fileId,
      userId: context.userId,
    });
  });

/** Envio pelo servidor (até 20 MB): reserva, se o envio direto ao Google não funcionar. */
export const uploadOsMedia = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
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
    const v = validarMidia(file.name, file.type, file.size);
    if (!v.ok) throw new Error(v.motivo);
    if (file.size > 20 * 1024 * 1024)
      throw new Error(`Arquivo de ${tamanhoLegivel(file.size)}: por aqui o limite é 20 MB.`);
    await assertWorkOrderAccess(workOrderId, context.supabase);
    const { uploadWorkOrderMedia } = await import("@/lib/os-media.server");
    return uploadWorkOrderMedia({
      workOrderId,
      destination: destination as (typeof allowed)[number],
      fileName: file.name.slice(0, 240),
      mimeType: v.tipo,
      bytes: new Uint8Array(await file.arrayBuffer()),
      userId: context.userId,
    });
  });
/** Destinos válidos para a OS e situação do compartilhamento com o e-mail do cliente. */
export const getOsMediaOptions = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
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
  .middleware([requireEmpresa])
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
