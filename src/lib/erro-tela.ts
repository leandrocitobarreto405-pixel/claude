/**
 * Mensagem de erro para a tela: as técnicas em inglês (do navegador ou do código) viram uma frase
 * em português; as nossas, já em português, passam como estão.
 */
const REDE =
  /failed to fetch|networkerror|load failed|network request failed|err_internet|err_network/i;
const TECNICA =
  /cannot read propert|is not a function|is not defined|is not iterable|undefined|null \(reading|typeerror|referenceerror|syntaxerror|unexpected token|unexpected end of json|invariant failed|json\.parse|maximum call stack|chunkloaderror|dynamically imported module|aborterror|the operation was aborted/i;

export const ERRO_TELA = "Não consegui atualizar a tela, recarregue a página.";
export const ERRO_REDE = "Sem conexão com o servidor. Confira a internet e tente de novo.";

export function mensagemParaTela(texto: unknown, padrao = ERRO_TELA): string {
  const t = typeof texto === "string" ? texto.trim() : "";
  if (!t) return padrao;
  if (REDE.test(t)) return ERRO_REDE;
  if (TECNICA.test(t)) return ERRO_TELA;
  return t;
}

/** Texto de um erro qualquer (Error, texto ou outra coisa), já pronto para a tela. */
export function textoDoErro(e: unknown, padrao = ERRO_TELA): string {
  return mensagemParaTela(e instanceof Error ? e.message : typeof e === "string" ? e : "", padrao);
}
