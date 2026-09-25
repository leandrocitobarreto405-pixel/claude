import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEmpresaAtiva, setEmpresaAtiva } from "@/lib/empresa-ativa";

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

export type ContextoTenant = {
  /** Usuário é administrador da Nexa (vê e administra todas as empresas). */
  souNexa: boolean;
  /** Empresas que o usuário pode abrir, com o papel dele em cada uma. */
  empresas: VinculoEmpresa[];
  /** Empresa aberta nesta aba (null quando ainda não há nenhuma). */
  ativa: VinculoEmpresa | null;
};

export const CONTEXTO_TENANT_KEY = ["contexto_tenant"] as const;

/**
 * Carrega as empresas acessíveis e define a empresa ativa desta aba: a última escolhida,
 * se ainda for acessível; senão, a primeira da lista.
 */
export function useContextoTenant() {
  return useQuery({
    queryKey: CONTEXTO_TENANT_KEY,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ContextoTenant> => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return { souNexa: false, empresas: [], ativa: null };

      const [nexa, vinculos, empresas] = await Promise.all([
        supabase.rpc("sou_admin_nexa" as never),
        supabase.from("usuarios_empresa").select("empresa_id, papel").eq("user_id", userId),
        supabase
          .from("empresas")
          .select("id, nome, cnpj, telefone, plano, controle_insumos_ativo")
          .eq("ativo", true)
          .order("nome"),
      ]);
      if (vinculos.error) throw vinculos.error;
      if (empresas.error) throw empresas.error;

      const souNexa = nexa.data === true;
      const papelPorEmpresa = new Map(
        (vinculos.data ?? []).map((v) => [v.empresa_id, v.papel as Papel]),
      );
      const lista: VinculoEmpresa[] = [];
      for (const empresa of (empresas.data ?? []) as Empresa[]) {
        const papel = souNexa ? "admin" : papelPorEmpresa.get(empresa.id);
        if (papel) lista.push({ papel, empresa });
      }

      const salva = getEmpresaAtiva();
      const ativa = lista.find((v) => v.empresa.id === salva) ?? lista[0] ?? null;
      setEmpresaAtiva(ativa?.empresa.id ?? null);

      return { souNexa, empresas: lista, ativa };
    },
  });
}

/** Troca a empresa desta aba e recarrega o app, para nenhum dado da anterior ficar em cache. */
export function trocarEmpresa(empresaId: string, destino = "/inicio") {
  setEmpresaAtiva(empresaId);
  window.location.assign(destino);
}

/** Empresa ativa e papel do usuário nela. */
export function useMinhaEmpresa() {
  const q = useContextoTenant();
  return { ...q, data: q.data?.ativa ?? null };
}

export function usePapel(): { papel: Papel | null; carregando: boolean } {
  const q = useContextoTenant();
  return { papel: q.data?.ativa?.papel ?? null, carregando: q.isLoading };
}

/** Aceita convites pendentes do e-mail logado. Empresas novas são criadas pela Nexa. */
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

/** Rotas liberadas por papel. Admin acessa tudo da empresa; /nexa só a Nexa. */
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

const ROTAS_NEXA = ["/nexa"];

function combina(rotas: string[], pathname: string) {
  return rotas.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export function podeAcessar(papel: Papel | null, pathname: string, souNexa = false): boolean {
  if (combina(ROTAS_NEXA, pathname)) return souNexa;
  if (souNexa || papel === "admin") return true;
  if (!papel) return false;
  const permitidas = papel === "atendente" ? ROTAS_ATENDENTE : ROTAS_TECNICO;
  return combina(permitidas, pathname);
}

export function rotaInicial(papel: Papel | null): string {
  return papel === "tecnico" ? "/agenda" : "/inicio";
}
