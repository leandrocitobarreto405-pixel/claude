// Área da contadora no navegador: empresas dela e a empresa escolhida (guardada neste aparelho).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { empresasDaContadoraFn } from "@/lib/contadora.functions";

const CHAVE_EMPRESA = "nexa-contadora-empresa";

export function empresaGuardada(): string | null {
  try {
    return localStorage.getItem(CHAVE_EMPRESA);
  } catch {
    return null;
  }
}

export function guardarEmpresa(id: string) {
  try {
    localStorage.setItem(CHAVE_EMPRESA, id);
  } catch {
    /* sem armazenamento: vale só nesta tela */
  }
}

/** Empresas que a contadora atende e a ativa (a guardada, ou a primeira). */
export function useEmpresasDaContadora() {
  const listar = useServerFn(empresasDaContadoraFn);
  return useQuery({
    queryKey: ["contadora", "empresas"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const lista = (await listar()) ?? [];
      const salva = empresaGuardada();
      const ativa = lista.find((e) => e.empresa_id === salva) ?? lista[0] ?? null;
      return { lista, ativa };
    },
  });
}

/** Mês atual "AAAA-MM" (São Paulo). */
export function mesAtual(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
}

/** Baixa um arquivo vindo do servidor em base64. */
export function baixarBase64(a: { nome: string; tipo: string; base64: string }) {
  const bytes = Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: a.tipo }));
  const link = document.createElement("a");
  link.href = url;
  link.download = a.nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
