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
  slogan?: string;
  atividade?: string;
  frase_rodape?: string;
  telefone2?: string;
  assinatura_path?: string | null;
  assinante?: string;
  mostrar_assinatura?: boolean;
};

/** Campos que a tela de configurações pode mandar para a prévia antes de salvar. */
export type EmpresaPrevia = {
  nome: string;
  cnpj: string;
  email: string;
  telefone: string;
  endereco: string;
  instagram: string;
  logoPath: string | null;
  slogan: string;
  atividade: string;
  fraseRodape: string;
  telefone2: string;
  assinaturaPath: string | null;
  assinante: string;
  mostrarAssinatura: boolean;
};

const vazioNulo = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** Só aceita a imagem se o conteúdo bate com PNG ou JPG (senão o PDF sai sem logo). */
export function tipoDaImagem(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return null;
}

async function imagemDaPasta(
  db: ReturnType<typeof bancoDaEmpresa>,
  empresaId: string,
  caminho: string | null | undefined,
): Promise<EmpresaDocumento["logo"]> {
  if (!caminho || !caminho.startsWith(`${empresaId}/`)) return null;
  const { data } = await db.storage.from("empresa-logos").download(caminho);
  if (!data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const tipo = tipoDaImagem(bytes);
  return tipo ? { bytes, tipo } : null;
}

/**
 * Empresa para o PDF. Com `previa` (tela de configurações), usa os campos da tela ainda não
 * salvos; as imagens vêm sempre da pasta da empresa.
 */
export async function empresaDocumento(previa?: EmpresaPrevia): Promise<EmpresaDocumento> {
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
  const salvo = (cfg?.value ?? {}) as Company;
  const v: Company = previa
    ? {
        name: previa.nome,
        document: previa.cnpj,
        phone: previa.telefone,
        email: previa.email,
        endereco: previa.endereco,
        instagram: previa.instagram,
        logo_path: previa.logoPath,
        slogan: previa.slogan,
        atividade: previa.atividade,
        frase_rodape: previa.fraseRodape,
        telefone2: previa.telefone2,
        assinatura_path: previa.assinaturaPath,
        assinante: previa.assinante,
        mostrar_assinatura: previa.mostrarAssinatura,
      }
    : salvo;
  const [logo, assinatura] = await Promise.all([
    imagemDaPasta(db, empresaId, v.logo_path),
    imagemDaPasta(db, empresaId, v.assinatura_path),
  ]);
  return {
    nome: vazioNulo(v.name) ?? vazioNulo(empresa?.nome as string | undefined) ?? "Empresa",
    cnpj: vazioNulo(v.document),
    email: vazioNulo(v.email),
    telefone: vazioNulo(v.phone) ?? vazioNulo(empresa?.telefone as string | undefined),
    endereco: vazioNulo(v.endereco),
    instagram: vazioNulo(v.instagram),
    logo,
    slogan: vazioNulo(v.slogan),
    atividade: vazioNulo(v.atividade),
    fraseRodape: vazioNulo(v.frase_rodape),
    telefone2: vazioNulo(v.telefone2),
    assinatura,
    assinante: vazioNulo(v.assinante),
    mostrarAssinatura: v.mostrar_assinatura === true,
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
