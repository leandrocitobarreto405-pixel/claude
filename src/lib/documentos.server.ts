/**
 * Dados para os documentos em PDF gerados no app: empresa (com a logo da pasta privada) e a
 * configuração de Configurações › Documentos. Tudo pelo banco do usuário (RLS da empresa ativa).
 */
import { bancoDaEmpresa, contextoEmpresa } from "@/lib/request-db.server";
import {
  TEXTOS_PADRAO,
  configDocumentos,
  type ConfigDocumentos,
  type EmpresaDocumento,
} from "@/lib/pdf/textos-padrao";

export const CHAVE_CONFIG_DOCUMENTOS = "documentos";

type Company = {
  name?: string;
  document?: string;
  phone?: string;
  email?: string;
  endereco?: string;
  instagram?: string;
  logo_path?: string | null;
};

const vazioNulo = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** Só aceita a imagem se o conteúdo bate com PNG ou JPG (senão o PDF sai sem logo). */
export function tipoDaImagem(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return null;
}

export async function empresaDocumento(): Promise<EmpresaDocumento> {
  const db = bancoDaEmpresa();
  const { empresaId } = contextoEmpresa();
  const [{ data: empresa }, { data: cfg }] = await Promise.all([
    db.from("empresas").select("nome, telefone").eq("id", empresaId).maybeSingle(),
    db
      .from("app_settings")
      .select("value")
      .eq("empresa_id", empresaId)
      .eq("key", "company")
      .maybeSingle(),
  ]);
  const v = (cfg?.value ?? {}) as Company;
  let logo: EmpresaDocumento["logo"] = null;
  if (v.logo_path && v.logo_path.startsWith(`${empresaId}/`)) {
    const { data } = await db.storage.from("empresa-logos").download(v.logo_path);
    if (data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const tipo = tipoDaImagem(bytes);
      if (tipo) logo = { bytes, tipo };
    }
  }
  return {
    nome: vazioNulo(v.name) ?? vazioNulo(empresa?.nome as string | undefined) ?? "Empresa",
    cnpj: vazioNulo(v.document),
    email: vazioNulo(v.email),
    telefone: vazioNulo(v.phone) ?? vazioNulo(empresa?.telefone as string | undefined),
    endereco: vazioNulo(v.endereco),
    instagram: vazioNulo(v.instagram),
    logo,
  };
}

export async function lerConfigDocumentos(): Promise<ConfigDocumentos> {
  const { data } = await bancoDaEmpresa()
    .from("app_settings")
    .select("value")
    .eq("empresa_id", contextoEmpresa().empresaId)
    .eq("key", CHAVE_CONFIG_DOCUMENTOS)
    .maybeSingle();
  return configDocumentos(data?.value);
}

/** Grava só o que difere do padrão (textos iguais ao padrão acompanham futuras correções). */
export async function salvarConfigDocumentos(c: ConfigDocumentos) {
  const valor: Record<string, unknown> = { modo: c.modo };
  for (const k of Object.keys(TEXTOS_PADRAO) as Array<keyof typeof TEXTOS_PADRAO>) {
    if (c[k] !== TEXTOS_PADRAO[k]) valor[k] = c[k];
  }
  const { error } = await bancoDaEmpresa()
    .from("app_settings")
    .upsert(
      {
        empresa_id: contextoEmpresa().empresaId,
        key: CHAVE_CONFIG_DOCUMENTOS,
        value: valor as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id,key" },
    );
  if (error) throw new Error("Não foi possível salvar a configuração dos documentos.");
}

export function paraBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}
