import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Papel = "admin" | "atendente" | "tecnico";

export type Empresa = {
  id: string;
  nome: string;
  cnpj: string | null;
  telefone: string | null;
  plano: string;
  controle_insumos_ativo: boolean;
};

export type VinculoEmpresa = {
  papel: Papel;
  empresa: Empresa;
};

/** Empresa e papel do usuário logado. */
export function useMinhaEmpresa() {
  return useQuery({
    queryKey: ["minha_empresa"],
    queryFn: async (): Promise<VinculoEmpresa | null> => {
      const { data, error } = await supabase
        .from("usuarios_empresa")
        .select(
          "papel, empresa:empresa_id ( id, nome, cnpj, telefone, plano, controle_insumos_ativo )",
        )
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data?.empresa) return null;
      return {
        papel: data.papel as Papel,
        empresa: data.empresa as unknown as Empresa,
      };
    },
  });
}

export function usePapel(): { papel: Papel | null; carregando: boolean } {
  const q = useMinhaEmpresa();
  return { papel: q.data?.papel ?? null, carregando: q.isLoading };
}

/** Cria a empresa no cadastro (ou aceita o convite recebido por e-mail). */
export async function registrarEmpresa(input: {
  nome: string;
  cnpj?: string | null;
  telefone?: string | null;
}) {
  const { data, error } = await supabase.rpc("registrar_empresa", {
    _nome: input.nome,
    _cnpj: input.cnpj ?? null,
    _telefone: input.telefone ?? null,
  } as never);
  if (error) throw error;
  return data as unknown as string;
}

export async function convidarUsuario(email: string, papel: Papel) {
  const { error } = await supabase.rpc("convidar_usuario", {
    _email: email,
    _papel: papel,
  } as never);
  if (error) throw error;
}

/** Rotas liberadas por papel. Admin acessa tudo. */
const ROTAS_ATENDENTE = [
  "/inicio",
  "/nova-os",
  "/oss",
  "/orcamentos",
  "/os",
  "/agenda",
  "/mensagens",
  "/servicos",
  "/a-receber",
  "/notas",
  "/crm",
];

const ROTAS_TECNICO = ["/agenda", "/mensagens", "/servicos", "/os"];

export function podeAcessar(papel: Papel | null, pathname: string): boolean {
  if (!papel || papel === "admin") return true;
  const permitidas = papel === "atendente" ? ROTAS_ATENDENTE : ROTAS_TECNICO;
  return permitidas.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export function rotaInicial(papel: Papel | null): string {
  return papel === "tecnico" ? "/agenda" : "/inicio";
}
