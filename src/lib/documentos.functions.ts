/**
 * Dados da empresa que aparecem nos documentos em PDF (Configurações › Empresa). Ficam no mesmo
 * app_settings "company" que o cadastro já usa (name/phone/document; a Alice lê name e phone):
 * aqui só se acrescentam e-mail, endereço, Instagram e o caminho da logo. Leitura por qualquer
 * pessoa da empresa; alteração só pelo admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import type { ArquivoPdf } from "@/lib/compartilhar-pdf";
import { TEXTOS_PADRAO, configDocumentos, type ConfigDocumentos } from "@/lib/pdf/textos-padrao";

export const CHAVE_DADOS_EMPRESA = ["dados-empresa-documento"] as const;

export type DadosEmpresaForm = {
  nome: string;
  cnpj: string;
  email: string;
  telefone: string;
  endereco: string;
  instagram: string;
  logoPath: string | null;
};

type Company = {
  name?: string;
  document?: string;
  phone?: string;
  email?: string;
  endereco?: string;
  instagram?: string;
  logo_path?: string | null;
  [k: string]: unknown;
};

const LOGO = /^[0-9a-f-]{36}\/logo\.(png|jpg)$/i;

export const lerDadosEmpresaFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<DadosEmpresaForm> => {
    const [{ data: empresa }, { data: cfg }] = await Promise.all([
      context.supabase
        .from("empresas")
        .select("nome, telefone")
        .eq("id", context.empresaId)
        .maybeSingle(),
      context.supabase
        .from("app_settings")
        .select("value")
        .eq("empresa_id", context.empresaId)
        .eq("key", "company")
        .maybeSingle(),
    ]);
    const v = (cfg?.value ?? {}) as Company;
    return {
      nome: v.name || empresa?.nome || "",
      cnpj: v.document ?? "",
      email: v.email ?? "",
      telefone: v.phone || empresa?.telefone || "",
      endereco: v.endereco ?? "",
      instagram: v.instagram ?? "",
      logoPath: typeof v.logo_path === "string" && LOGO.test(v.logo_path) ? v.logo_path : null,
    };
  });

const campo = (v: unknown, max: number, nome: string) => {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) throw new Error(`${nome}: no máximo ${max} caracteres.`);
  return s;
};

export const salvarDadosEmpresaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((d: DadosEmpresaForm): DadosEmpresaForm => {
    const out: DadosEmpresaForm = {
      nome: campo(d.nome, 120, "Nome"),
      cnpj: campo(d.cnpj, 30, "CNPJ"),
      email: campo(d.email, 120, "E-mail"),
      telefone: campo(d.telefone, 40, "Telefone"),
      endereco: campo(d.endereco, 200, "Endereço"),
      instagram: campo(d.instagram, 80, "Instagram"),
      logoPath: d.logoPath ? String(d.logoPath) : null,
    };
    if (!out.nome) throw new Error("Informe o nome da empresa.");
    if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))
      throw new Error("E-mail inválido.");
    if (out.logoPath && !LOGO.test(out.logoPath)) throw new Error("Logo inválida.");
    return out;
  })
  .handler(async ({ data: d, context }) => {
    if (d.logoPath && !d.logoPath.startsWith(`${context.empresaId}/`))
      throw new Error("Logo inválida.");
    const { data: atual } = await context.supabase
      .from("app_settings")
      .select("value")
      .eq("empresa_id", context.empresaId)
      .eq("key", "company")
      .maybeSingle();
    const value: Company = {
      ...((atual?.value ?? {}) as Company),
      name: d.nome,
      document: d.cnpj,
      phone: d.telefone,
      email: d.email,
      endereco: d.endereco,
      instagram: d.instagram,
      logo_path: d.logoPath,
    };
    const { error } = await context.supabase.from("app_settings").upsert(
      {
        empresa_id: context.empresaId,
        key: "company",
        value: value as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id,key" },
    );
    if (error) throw new Error("Não foi possível salvar os dados da empresa.");
    return { ok: true };
  });

// ---------------------------------------------------------------- Configurações › Documentos

export const CHAVE_CONFIG_DOCUMENTOS = ["config-documentos"] as const;

export type RespostaConfigDocumentos = {
  config: ConfigDocumentos;
  padrao: typeof TEXTOS_PADRAO;
};

export const lerConfigDocumentosFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async (): Promise<RespostaConfigDocumentos> => {
    const { lerConfigDocumentos } = await import("@/lib/documentos.server");
    return { config: await lerConfigDocumentos(), padrao: TEXTOS_PADRAO };
  });

const MAX_TEXTO = 20000;

/** Confere tamanhos e faixas; texto vazio volta ao padrão. */
function validarConfig(c: ConfigDocumentos): ConfigDocumentos {
  const bruto = (c ?? {}) as Partial<ConfigDocumentos>;
  for (const k of [
    "validade",
    "cancelamento",
    "beneficios",
    "garantia_os",
    "termo",
    "agradecimento",
  ] as const) {
    if (typeof bruto[k] === "string" && bruto[k]!.length > MAX_TEXTO)
      throw new Error(`Texto muito longo (máximo ${MAX_TEXTO} caracteres).`);
  }
  const faixas = [
    ["garantia_meses", 1, 120, "Meses de garantia"],
    ["visitas_gratuitas", 0, 20, "Visitas gratuitas"],
    ["pct_manutencao", 0, 100, "% da manutenção"],
    ["valor_km", 0, 100, "R$ por km"],
  ] as const;
  for (const [k, min, max, nome] of faixas) {
    const v = Number(bruto[k]);
    if (!Number.isFinite(v) || v < min || v > max)
      throw new Error(`${nome}: use de ${min} a ${max}.`);
  }
  return configDocumentos({ ...bruto, modo: bruto.modo === "pdf" ? "pdf" : "drive" });
}

export const salvarConfigDocumentosFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(validarConfig)
  .handler(async ({ data }) => {
    const { salvarConfigDocumentos } = await import("@/lib/documentos.server");
    await salvarConfigDocumentos(data);
    return { ok: true };
  });

/** "Ver PDF de exemplo": dados fictícios com a empresa e os textos da tela (mesmo sem salvar). */
export const pdfExemploFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { tipo: "os" | "termo"; config: ConfigDocumentos }) => ({
    tipo: i.tipo === "termo" ? ("termo" as const) : ("os" as const),
    config: validarConfig(i.config),
  }))
  .handler(async ({ data }): Promise<ArquivoPdf> => {
    const { empresaDocumento, paraBase64 } = await import("@/lib/documentos.server");
    const { EXEMPLO_OS, EXEMPLO_TERMO, pdfDaOs, pdfDoTermo } = await import("@/lib/pdf/os-pdf");
    const empresa = await empresaDocumento();
    const bytes =
      data.tipo === "termo"
        ? await pdfDoTermo(EXEMPLO_TERMO, empresa, data.config)
        : await pdfDaOs(EXEMPLO_OS, empresa, data.config);
    return {
      base64: paraBase64(bytes),
      nome: data.tipo === "termo" ? "Termo de garantia - exemplo.pdf" : "OS 0001 - exemplo.pdf",
    };
  });

// ---------------------------------------------------------------- PDF da OS e termo

/** Modo dos documentos da OS (Drive ou PDF no app), para as telas escolherem o botão. */
export const modoDocumentosFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async () => {
    const { lerConfigDocumentos } = await import("@/lib/documentos.server");
    return { modo: (await lerConfigDocumentos()).modo };
  });

const ID = /^[0-9a-f-]{36}$/i;
const validarOs = (i: { workOrderId: string }) => {
  const workOrderId = String(i?.workOrderId ?? "");
  if (!ID.test(workOrderId)) throw new Error("OS inválida.");
  return { workOrderId };
};

/** PDF da OS, gerado na hora e devolvido (não fica salvo). Técnico não vê valores: não baixa. */
export const pdfDaOsFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator(validarOs)
  .handler(async ({ data, context }): Promise<ArquivoPdf> => {
    const { data: papel } = await context.supabase.rpc("meu_papel" as never);
    if (papel === "tecnico") throw new Error("O PDF da OS tem valores: peça a quem atende.");
    const { empresaDocumento, lerConfigDocumentos, paraBase64 } =
      await import("@/lib/documentos.server");
    const { dadosOsPdf } = await import("@/lib/os-docs.server");
    const { nomeArquivoOs, pdfDaOs } = await import("@/lib/pdf/os-pdf");
    const [dados, empresa, config] = await Promise.all([
      dadosOsPdf(data.workOrderId),
      empresaDocumento(),
      lerConfigDocumentos(),
    ]);
    return {
      base64: paraBase64(await pdfDaOs(dados, empresa, config)),
      nome: nomeArquivoOs(dados.numero, dados.cliente),
    };
  });

/** Se a OS já pode ter termo em PDF (impermeabilização com visita concluída). */
export const termoDisponivelFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator(validarOs)
  .handler(async ({ data }) => {
    const { dadosTermoPdf } = await import("@/lib/os-docs.server");
    return { disponivel: Boolean(await dadosTermoPdf(data.workOrderId, 12)) };
  });

export const termoPdfFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator(validarOs)
  .handler(async ({ data }): Promise<ArquivoPdf> => {
    const { empresaDocumento, lerConfigDocumentos, paraBase64 } =
      await import("@/lib/documentos.server");
    const { dadosTermoPdf } = await import("@/lib/os-docs.server");
    const { nomeArquivoOs, pdfDoTermo } = await import("@/lib/pdf/os-pdf");
    const [empresa, config] = await Promise.all([empresaDocumento(), lerConfigDocumentos()]);
    const dados = await dadosTermoPdf(data.workOrderId, config.garantia_meses);
    if (!dados)
      throw new Error("O termo sai depois de uma visita de impermeabilização concluída nesta OS.");
    return {
      base64: paraBase64(await pdfDoTermo(dados, empresa, config)),
      nome: `Termo de garantia - ${nomeArquivoOs(dados.numero, dados.cliente)}`,
    };
  });
