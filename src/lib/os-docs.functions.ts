import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";

export type OsDocStatus = {
  enabled: boolean;
  autoGenerate: boolean;
  nameTemplate: string;
  hasHigienizacao: boolean;
  hasImpermeabilizacao: boolean;
  hasCombinado: boolean;
  hasFolder: boolean;
  configured: boolean;
};

export type OsDocumentInfo = {
  id: string;
  status: string;
  url: string | null;
  name: string | null;
  version: number;
  templateType: string;
  generatedAt: string | null;
  errorMessage: string | null;
  outdated: boolean;
};

export const getOsDocSettings = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async (): Promise<OsDocStatus> => {
    const { readSettings } = await import("@/lib/os-docs.server");
    const s = await readSettings();
    return {
      enabled: s.enabled,
      autoGenerate: s.autoGenerate,
      nameTemplate: s.nameTemplate,
      hasHigienizacao: Boolean(s.templateHigienizacao),
      hasImpermeabilizacao: Boolean(s.templateImpermeabilizacao),
      hasCombinado: Boolean(s.templateCombinado),
      hasFolder: Boolean(s.folderId),
      configured: Boolean(
        s.templateHigienizacao && s.templateImpermeabilizacao && s.templateCombinado && s.folderId,
      ),
    };
  });

export const saveOsDocSettings = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (input: {
      enabled: boolean;
      autoGenerate: boolean;
      nameTemplate: string;
      higienizacao: string;
      impermeabilizacao: string;
      combinado: string;
      pasta: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { saveSettings } = await import("@/lib/os-docs.server");
    return saveSettings(data);
  });

export const testOsDocIntegration = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .handler(async () => {
    const { testIntegration } = await import("@/lib/os-docs.server");
    return testIntegration();
  });

export const getOsDocument = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { workOrderId: string }) => input)
  .handler(async ({ data }): Promise<OsDocumentInfo | null> => {
    const { loadDocument } = await import("@/lib/os-docs.server");
    return loadDocument(data.workOrderId);
  });

export const generateOsDocument = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { workOrderId: string; mode?: "novo" | "atualizar" | "versao" }) => input)
  .handler(async ({ data, context }) => {
    const { generateDocument } = await import("@/lib/os-docs.server");
    return generateDocument(data.workOrderId, data.mode ?? "novo", context.userId);
  });

export type OsWarrantyInfo = {
  available: boolean;
  document: {
    id: string;
    status: string;
    url: string | null;
    name: string | null;
    version: number;
    generatedAt: string | null;
    errorMessage: string | null;
  } | null;
};

export const getOsWarranty = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { workOrderId: string }) => input)
  .handler(async ({ data }): Promise<OsWarrantyInfo> => {
    const { loadWarranty } = await import("@/lib/os-docs.server");
    return loadWarranty(data.workOrderId);
  });

export const generateOsWarranty = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { workOrderId: string }) => input)
  .handler(async ({ data, context }) => {
    const { generateWarranty } = await import("@/lib/os-docs.server");
    return generateWarranty(data.workOrderId, context.userId);
  });
