/**
 * Empresa ativa desta aba do navegador.
 *
 * Vai no cabeçalho `x-empresa-id` de toda chamada ao banco e às funções do servidor.
 * O banco só aceita o valor se o usuário tiver acesso à empresa (ver private.empresa_ativa),
 * então isto é uma escolha de contexto, não uma permissão.
 *
 * "Nexa (painel)" (só nexa_admin) é um espaço separado das empresas: nenhuma empresa ativa, nenhum
 * cabeçalho de empresa, e o menu mostra só as telas da plataforma.
 */

/** Valor guardado quando a escolha é o Painel Nexa (não é id de empresa). */
export const PAINEL_NEXA = "painel-nexa";

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

/** Empresa ativa (null no Painel Nexa ou sem escolha). */
export function getEmpresaAtiva(): string | null {
  return atual === PAINEL_NEXA ? null : atual;
}

/** A escolha desta aba é o Painel Nexa? */
export function noPainelNexa(): boolean {
  return atual === PAINEL_NEXA;
}

/** Id da empresa, PAINEL_NEXA ou null. */
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
