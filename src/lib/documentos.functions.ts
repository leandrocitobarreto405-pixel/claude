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
  /** Linha abaixo do nome no cabeçalho do PDF. */
  slogan: string;
  /** "NOME | atividade" no rodapé. */
  atividade: string;
  fraseRodape: string;
  telefone2: string;
  assinaturaPath: string | null;
  assinante: string;
  mostrarAssinatura: boolean;
};

type Company = {
  name?: string;
  document?: string;
  phone?: string;
  email?: string;
  endereco?: string;
  instagram?: string;
  logo_path?: string | null;
  slogan?: string;
  atividade?: string;
  frase_rodape?: string;
  telefone2?: string;
  assinatura_path?: string | null;
  assinante?: string;
  mostrar_assinatura?: boolean;
  [k: string]: unknown;
};

const LOGO = /^[0-9a-f-]{36}\/logo\.(png|jpg)$/i;
const ASSINATURA = /^[0-9a-f-]{36}\/assinatura\.png$/i;

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
      slogan: v.slogan ?? "",
      atividade: v.atividade ?? "",
      fraseRodape: v.frase_rodape ?? "",
      telefone2: v.telefone2 ?? "",
      assinaturaPath:
        typeof v.assinatura_path === "string" && ASSINATURA.test(v.assinatura_path)
          ? v.assinatura_path
          : null,
      assinante: v.assinante ?? "",
      mostrarAssinatura: v.mostrar_assinatura === true,
    };
  });

const campo = (v: unknown, max: number, nome: string) => {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) throw new Error(`${nome}: no máximo ${max} caracteres.`);
  return s;
};

/** Confere os campos da tela (salvar e prévia usam a mesma regra). */
export function validarDadosEmpresa(d: DadosEmpresaForm): DadosEmpresaForm {
  const out: DadosEmpresaForm = {
    nome: campo(d.nome, 120, "Nome"),
    cnpj: campo(d.cnpj, 30, "CNPJ"),
    email: campo(d.email, 120, "E-mail"),
    telefone: campo(d.telefone, 40, "Telefone"),
    endereco: campo(d.endereco, 200, "Endereço"),
    instagram: campo(d.instagram, 80, "Instagram"),
    logoPath: d.logoPath ? String(d.logoPath) : null,
    slogan: campo(d.slogan, 120, "Slogan"),
    atividade: campo(d.atividade, 80, "Atividade"),
    fraseRodape: campo(d.fraseRodape, 200, "Frase do rodapé"),
    telefone2: campo(d.telefone2, 40, "Segundo telefone"),
    assinaturaPath: d.assinaturaPath ? String(d.assinaturaPath) : null,
    assinante: campo(d.assinante, 80, "Quem assina"),
    mostrarAssinatura: d.mostrarAssinatura === true,
  };
  if (!out.nome) throw new Error("Informe o nome da empresa.");
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))
    throw new Error("E-mail inválido.");
  if (out.logoPath && !LOGO.test(out.logoPath)) throw new Error("Logo inválida.");
  if (out.assinaturaPath && !ASSINATURA.test(out.assinaturaPath))
    throw new Error("Assinatura inválida.");
  return out;
}

export const salvarDadosEmpresaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(validarDadosEmpresa)
  .handler(async ({ data: d, context }) => {
    if (d.logoPath && !d.logoPath.startsWith(`${context.empresaId}/`))
      throw new Error("Logo inválida.");
    if (d.assinaturaPath && !d.assinaturaPath.startsWith(`${context.empresaId}/`))
      throw new Error("Assinatura inválida.");
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
      slogan: d.slogan,
      atividade: d.atividade,
      frase_rodape: d.fraseRodape,
      telefone2: d.telefone2,
      assinatura_path: d.assinaturaPath,
      assinante: d.assinante,
      mostrar_assinatura: d.mostrarAssinatura,
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

/**
 * "Ver PDF de exemplo" / prévia: dados fictícios com a empresa e os textos da tela (mesmo sem
 * salvar). `empresa` é a prévia de Configurações › Empresa; sem `config`, vale a salva.
 */
export const pdfExemploFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (i: {
      tipo: "os" | "termo" | "orcamento";
      config?: ConfigDocumentos;
      empresa?: DadosEmpresaForm;
    }) => ({
      tipo:
        i.tipo === "termo"
          ? ("termo" as const)
          : i.tipo === "orcamento"
            ? ("orcamento" as const)
            : ("os" as const),
      config: i.config ? validarConfig(i.config) : null,
      empresa: i.empresa ? validarDadosEmpresa(i.empresa) : null,
    }),
  )
  .handler(async ({ data, context }): Promise<ArquivoPdf> => {
    const { empresaDocumento, lerConfigDocumentos, paraBase64 } =
      await import("@/lib/documentos.server");
    const { EXEMPLO_OS, EXEMPLO_ORCAMENTO, EXEMPLO_TERMO, pdfDaOs, pdfDoTermo } =
      await import("@/lib/pdf/os-pdf");
    if (data.empresa) {
      for (const c of [data.empresa.logoPath, data.empresa.assinaturaPath])
        if (c && !c.startsWith(`${context.empresaId}/`)) throw new Error("Imagem inválida.");
    }
    const [empresa, config] = await Promise.all([
      empresaDocumento(data.empresa ?? undefined),
      data.config ?? lerConfigDocumentos(),
    ]);
    const bytes =
      data.tipo === "termo"
        ? await pdfDoTermo(EXEMPLO_TERMO, empresa, config)
        : data.tipo === "orcamento"
          ? await pdfDaOs(EXEMPLO_ORCAMENTO, empresa, config)
          : await pdfDaOs(EXEMPLO_OS, empresa, config);
    return {
      base64: paraBase64(bytes),
      nome:
        data.tipo === "termo"
          ? "Termo de garantia - exemplo.pdf"
          : data.tipo === "orcamento"
            ? "Orçamento 0001 - exemplo.pdf"
            : "OS 0001 - exemplo.pdf",
    };
  });

// ---------------------------------------------------------------- PDF da OS e termo

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

// ---------------------------------------------------------------- PDF do orçamento

/**
 * PDF do orçamento no layout do PDF da OS, gerado na hora (não fica salvo): não cria OS, não
 * usa número de OS e não chama o Drive. Técnico não vê valores: não baixa.
 */
export const pdfDoOrcamentoFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((i: { quoteId: string }) => {
    const quoteId = String(i?.quoteId ?? "");
    if (!ID.test(quoteId)) throw new Error("Orçamento inválido.");
    return { quoteId };
  })
  .handler(async ({ data, context }): Promise<ArquivoPdf> => {
    const { data: papel } = await context.supabase.rpc("meu_papel" as never);
    if (papel === "tecnico") throw new Error("O PDF do orçamento tem valores: peça a quem atende.");
    const { empresaDocumento, lerConfigDocumentos, paraBase64 } =
      await import("@/lib/documentos.server");
    const { dadosOrcamentoPdf } = await import("@/lib/os-docs.server");
    const { nomeArquivoOrcamento, pdfDaOs } = await import("@/lib/pdf/os-pdf");
    const [dados, empresa, config] = await Promise.all([
      dadosOrcamentoPdf(data.quoteId),
      empresaDocumento(),
      lerConfigDocumentos(),
    ]);
    return {
      base64: paraBase64(await pdfDaOs(dados, empresa, config)),
      nome: nomeArquivoOrcamento(dados.numero, dados.cliente),
    };
  });
