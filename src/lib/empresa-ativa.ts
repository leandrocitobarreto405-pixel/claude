/**
 * Empresa ativa desta aba do navegador.
 *
 * Vai no cabeçalho `x-empresa-id` de toda chamada ao banco e às funções do servidor.
 * O banco só aceita o valor se o usuário tiver acesso à empresa (ver private.empresa_ativa),
 * então isto é uma escolha de contexto, não uma permissão.
 */

export const EMPRESA_HEADER = "x-empresa-id";
const CHAVE = "nexa.empresaAtiva";

function lerSalva(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

let atual: string | null = lerSalva();

export function getEmpresaAtiva(): string | null {
  return atual;
}

export function setEmpresaAtiva(id: string | null) {
  atual = id;
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(CHAVE, id);
    else window.localStorage.removeItem(CHAVE);
  } catch {
    // Sem localStorage (aba privada, bloqueio): a escolha vale só para esta aba.
  }
}
