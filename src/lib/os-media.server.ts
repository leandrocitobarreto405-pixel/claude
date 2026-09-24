import {
  driveFolderUrl,
  findOrCreateFolderStrict,
  renameFile,
  shareFolderForAnyone,
  shareFolderWithEmail,
  uploadFile,
} from "@/lib/google-docs.server";

export type MediaDestination = "Antes" | "Depois" | "Vídeos" | "Controle interno";

type WorkOrderFolderData = {
  id: string;
  empresa_id: string;
  os_number: string;
  customer: { full_name: string; email: string | null } | null;
  visits: { status: string; service_type: { name: string } | null }[];
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function configuredRootFolder() {
  const db = await admin();
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "os_document_settings")
    .maybeSingle();
  const settings = (data?.value ?? {}) as { enabled?: boolean; folderId?: string };
  if (!settings.enabled || !settings.folderId) {
    throw new Error("Configure e ative a integração com o Google Drive.");
  }
  return settings.folderId;
}

function cleanFolderName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

function isHig(name: string) {
  return name.toLowerCase().includes("higien");
}
function isImp(name: string) {
  return name.toLowerCase().includes("impermeab");
}

async function loadWorkOrder(workOrderId: string): Promise<WorkOrderFolderData> {
  const db = await admin();
  const { data, error } = await db
    .from("work_orders")
    .select(
      `id, empresa_id, os_number,
       customer:customer_id ( full_name, email ),
       visits!visits_work_order_id_fkey ( status, service_type:service_type_id ( name ) )`,
    )
    .eq("id", workOrderId)
    .single();
  if (error || !data) throw new Error("Ordem de serviço não encontrada.");
  return data as unknown as WorkOrderFolderData;
}

/** Serviços ativos da OS: definem quais subpastas de mídia existem. */
function serviceFlags(wo: WorkOrderFolderData) {
  const ativos = (wo.visits ?? []).filter((v) => v.status !== "Cancelado");
  const nomes = ativos.map((v) => v.service_type?.name ?? "");
  const hig = nomes.some(isHig);
  const imp = nomes.some(isImp);
  // OS sem serviço identificado: mantém as três pastas para não travar o envio.
  if (!hig && !imp) return { hig: true, imp: true };
  return { hig, imp };
}

export function allowedDestinationsFor(hig: boolean, imp: boolean): MediaDestination[] {
  const list: MediaDestination[] = [];
  if (hig) list.push("Antes", "Depois");
  if (imp) list.push("Vídeos");
  list.push("Controle interno");
  return list;
}

function customerFolderName(wo: WorkOrderFolderData) {
  return cleanFolderName(
    `OS ${wo.os_number} - ${wo.customer?.full_name ?? "Cliente"} - Turbine Clean`,
  );
}

function internalFolderName(wo: WorkOrderFolderData) {
  return cleanFolderName(
    `OS ${wo.os_number} - ${wo.customer?.full_name ?? "Cliente"} - Controle interno`,
  );
}

export async function ensureMaterialsFolders(workOrderId: string) {
  const db = await admin();
  const wo = await loadWorkOrder(workOrderId);
  const rootFolderId = await configuredRootFolder();
  const { hig, imp } = serviceFlags(wo);

  const { data: saved } = await db
    .from("os_drive_folders")
    .select("*")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  const nome = customerFolderName(wo);
  const completo =
    Boolean(saved?.materials_folder_id) &&
    saved?.folder_name === nome &&
    (!hig || (saved?.before_folder_id && saved?.after_folder_id)) &&
    (!imp || saved?.videos_folder_id);
  if (saved && completo) return saved;

  const now = new Date();
  const year = saved?.folder_year || String(now.getFullYear());
  const month = saved?.folder_month || String(now.getMonth() + 1).padStart(2, "0");

  let materialsFolderId = saved?.materials_folder_id ?? null;
  if (materialsFolderId && saved?.folder_name && saved.folder_name !== nome) {
    // Pasta já existe com nome antigo: apenas renomeia, preservando o conteúdo.
    await renameFile(materialsFolderId, nome);
  } else if (!materialsFolderId) {
    const root = await findOrCreateFolderStrict("Materiais dos clientes", rootFolderId);
    const yearFolder = await findOrCreateFolderStrict(year, root);
    const monthFolder = await findOrCreateFolderStrict(month, yearFolder);
    materialsFolderId = await findOrCreateFolderStrict(nome, monthFolder);
  } else if (!saved?.folder_name) {
    await renameFile(materialsFolderId, nome);
  }

  const beforeFolderId = hig
    ? saved?.before_folder_id || (await findOrCreateFolderStrict("Antes", materialsFolderId))
    : (saved?.before_folder_id ?? null);
  const afterFolderId = hig
    ? saved?.after_folder_id || (await findOrCreateFolderStrict("Depois", materialsFolderId))
    : (saved?.after_folder_id ?? null);
  const videosFolderId = imp
    ? saved?.videos_folder_id || (await findOrCreateFolderStrict("Vídeos", materialsFolderId))
    : (saved?.videos_folder_id ?? null);

  const row = {
    empresa_id: wo.empresa_id,
    work_order_id: wo.id,
    materials_folder_id: materialsFolderId,
    materials_folder_url: saved?.materials_folder_url ?? driveFolderUrl(materialsFolderId),
    folder_name: nome,
    before_folder_id: beforeFolderId,
    after_folder_id: afterFolderId,
    videos_folder_id: videosFolderId,
    folder_year: year,
    folder_month: month,
  };
  const { data, error } = await db
    .from("os_drive_folders")
    .upsert(row, { onConflict: "work_order_id" })
    .select("*")
    .single();
  if (error || !data) throw new Error("Não foi possível registrar as pastas desta OS.");
  return data;
}

async function ensureInternalFolder(workOrderId: string) {
  const db = await admin();
  const materials = await ensureMaterialsFolders(workOrderId);
  const wo = await loadWorkOrder(workOrderId);
  const nome = internalFolderName(wo);
  if (materials.internal_folder_id) {
    await renameFile(materials.internal_folder_id, nome).catch(() => undefined);
    return materials.internal_folder_id;
  }
  const rootFolderId = await configuredRootFolder();
  const root = await findOrCreateFolderStrict("Controle interno", rootFolderId);
  const yearFolder = await findOrCreateFolderStrict(materials.folder_year, root);
  const monthFolder = await findOrCreateFolderStrict(materials.folder_month, yearFolder);
  const folderId = await findOrCreateFolderStrict(nome, monthFolder);
  const { error } = await db
    .from("os_drive_folders")
    .update({ internal_folder_id: folderId })
    .eq("id", materials.id);
  if (error) throw new Error("Não foi possível registrar a pasta de controle interno.");
  return folderId;
}

export async function destinationFolder(workOrderId: string, destination: MediaDestination) {
  if (destination === "Controle interno") return ensureInternalFolder(workOrderId);
  const folders = await ensureMaterialsFolders(workOrderId);
  const folderId =
    destination === "Antes"
      ? folders.before_folder_id
      : destination === "Depois"
        ? folders.after_folder_id
        : folders.videos_folder_id;
  if (!folderId) {
    throw new Error(`Esta OS não usa a pasta "${destination}". Escolha outro destino.`);
  }
  return folderId;
}

export async function workOrderMediaOptions(workOrderId: string) {
  const wo = await loadWorkOrder(workOrderId);
  const { hig, imp } = serviceFlags(wo);
  const db = await admin();
  const { data } = await db
    .from("os_drive_folders")
    .select("customer_shared_email")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  return {
    destinations: allowedDestinationsFor(hig, imp),
    customerEmail: wo.customer?.email ?? null,
    sharedWithEmail: data?.customer_shared_email ?? null,
  };
}

export async function uploadWorkOrderMedia(input: {
  workOrderId: string;
  destination: MediaDestination;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  userId: string;
}) {
  const db = await admin();
  const wo = await loadWorkOrder(input.workOrderId);
  const folderId = await destinationFolder(input.workOrderId, input.destination);
  const uploaded = await uploadFile({
    name: input.fileName,
    mimeType: input.mimeType,
    parentId: folderId,
    bytes: input.bytes,
  });
  const { data: folders } = await db
    .from("os_drive_folders")
    .select("id")
    .eq("work_order_id", input.workOrderId)
    .single();
  if (!folders) throw new Error("Pastas da OS não encontradas.");
  const { error } = await db.from("os_drive_files").insert({
    empresa_id: wo.empresa_id,
    work_order_id: wo.id,
    folder_id: folders.id,
    destination: input.destination,
    google_file_id: uploaded.id,
    google_file_url: uploaded.webViewLink ?? null,
    file_name: input.fileName,
    mime_type: input.mimeType,
    file_size: input.bytes.byteLength,
    uploaded_by: input.userId,
  });
  if (error) throw new Error("O arquivo foi enviado, mas não foi registrado na OS.");
  return { id: uploaded.id, url: uploaded.webViewLink ?? null };
}

export async function listWorkOrderMedia(workOrderId: string) {
  const db = await admin();
  await loadWorkOrder(workOrderId);
  const { data, error } = await db
    .from("os_drive_files")
    .select("id, destination, file_name, mime_type, file_size, google_file_url, created_at")
    .eq("work_order_id", workOrderId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Não foi possível carregar os arquivos da OS.");
  return data ?? [];
}

export async function getCustomerFolderLink(workOrderId: string) {
  const folders = await ensureMaterialsFolders(workOrderId);
  const folderId = folders.materials_folder_id;
  if (!folderId) throw new Error("A pasta do cliente não foi criada no Google Drive.");
  const shared = await shareFolderForAnyone(folderId);
  const url = shared.webViewLink ?? driveFolderUrl(folderId);
  const db = await admin();
  await db.from("os_drive_folders").update({ materials_folder_url: url }).eq("id", folders.id);
  return { url };
}

/** Compartilha a pasta da OS com o e-mail do cliente uma única vez. */
export async function shareWithCustomerEmail(workOrderId: string) {
  const wo = await loadWorkOrder(workOrderId);
  const email = (wo.customer?.email ?? "").trim();
  if (!email) return { shared: false, reason: "sem_email" as const };
  const folders = await ensureMaterialsFolders(workOrderId);
  if (folders.customer_shared_email === email) {
    return { shared: true, email, alreadyShared: true };
  }
  if (!folders.materials_folder_id) throw new Error("A pasta desta OS não existe no Drive.");
  await shareFolderWithEmail(folders.materials_folder_id, email);
  const db = await admin();
  await db
    .from("os_drive_folders")
    .update({ customer_shared_email: email })
    .eq("id", folders.id);
  return { shared: true, email, alreadyShared: false };
}
