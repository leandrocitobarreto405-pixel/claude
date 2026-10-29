// Tema do app: Claro, Escuro ou Automático (segue o aparelho). A escolha fica no aparelho
// (localStorage "nexa-tema" = "claro" | "escuro"; Automático apaga a chave). O SCRIPT_TEMA do
// __root.tsx aplica antes da primeira pintura e segue o aparelho no Automático; aqui a troca
// vale na hora, sem recarregar.

export type Tema = "claro" | "escuro" | "automatico";

export const CHAVE_TEMA = "nexa-tema";

/** Cor da barra do navegador em cada tema (a mesma do SCRIPT_TEMA). */
export const COR_BARRA = { claro: "#0B2749", escuro: "#0A1628" } as const;

export function lerTema(): Tema {
  try {
    const t = localStorage.getItem(CHAVE_TEMA);
    return t === "claro" || t === "escuro" ? t : "automatico";
  } catch {
    return "automatico";
  }
}

/** O tema escolhido fica escuro? No Automático, depende do aparelho. */
export function ficaEscuro(tema: Tema, aparelhoEscuro: boolean): boolean {
  return tema === "escuro" || (tema === "automatico" && aparelhoEscuro);
}

/** Grava a escolha e aplica na hora. */
export function aplicarTema(tema: Tema) {
  try {
    if (tema === "automatico") localStorage.removeItem(CHAVE_TEMA);
    else localStorage.setItem(CHAVE_TEMA, tema);
  } catch {
    /* sem localStorage: aplica só nesta tela */
  }
  const escuro = ficaEscuro(tema, window.matchMedia("(prefers-color-scheme: dark)").matches);
  const h = document.documentElement;
  h.classList.toggle("dark", escuro);
  h.style.colorScheme = escuro ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", escuro ? COR_BARRA.escuro : COR_BARRA.claro);
}
