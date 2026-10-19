/**
 * Dados da empresa que aparecem nos documentos em PDF (Configurações › Empresa). Ficam no mesmo
 * app_settings "company" que o cadastro já usa (name/phone/document; a Alice lê name e phone):
 * aqui só se acrescentam e-mail, endereço, Instagram e o caminho da logo. Leitura por qualquer
 * pessoa da empresa; alteração só pelo admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";

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
